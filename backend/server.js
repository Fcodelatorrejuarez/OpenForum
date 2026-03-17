import cors from "cors";
import express from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const storePath = path.join(__dirname, "data", "store.json");

const app = express();
const PORT = Number(process.env.PORT ?? 4000);
const JWT_SECRET = process.env.JWT_SECRET ?? "dev-only-secret-change-me";

app.use(
  cors({
    origin: ["http://localhost:5173"],
    credentials: true
  })
);
app.use(express.json());

function isValidIsoDate(value) {
  return typeof value === "string" && !Number.isNaN(new Date(value).getTime());
}

function getTodayStamp() {
  return new Date().toISOString().slice(0, 10);
}

function userPublicFields(user) {
  return {
    id: user.id,
    username: user.username,
    reputation: user.reputation,
    activityScore: user.activityScore,
    createdAt: user.createdAt,
    lastActiveAt: user.lastActiveAt
  };
}

function normalizeComment(comment) {
  const createdAt = isValidIsoDate(comment.createdAt) ? comment.createdAt : new Date().toISOString();
  return {
    id: typeof comment.id === "string" ? comment.id : randomUUID(),
    authorId: typeof comment.authorId === "string" ? comment.authorId : "",
    content: typeof comment.content === "string" ? comment.content.trim() : "",
    createdAt
  };
}

function mapCommentForClient(comment, users) {
  const author = users.find((user) => user.id === comment.authorId);
  return {
    id: comment.id,
    authorId: comment.authorId,
    author: author ? author.username : "Unknown",
    authorReputation: author ? author.reputation : 0,
    content: comment.content,
    createdAt: comment.createdAt
  };
}

function buildNormalizedStore(input) {
  const source = input && typeof input === "object" ? input : {};
  const sourceUsers = Array.isArray(source.users) ? source.users : [];
  const sourcePosts = Array.isArray(source.posts) ? source.posts : [];

  let changed = !Array.isArray(source.users) || !Array.isArray(source.posts);

  const safePosts = sourcePosts.map((post) => {
    const createdAt = isValidIsoDate(post.createdAt) ? post.createdAt : new Date().toISOString();
    const updatedAt = isValidIsoDate(post.updatedAt) ? post.updatedAt : createdAt;
    const sourceCommentItems = Array.isArray(post.commentItems) ? post.commentItems : [];
    const commentItems = sourceCommentItems.map((comment) => normalizeComment(comment));
    const legacyCount = Number.isFinite(post.comments) ? Number(post.comments) : commentItems.length;
    const comments = Math.max(legacyCount, commentItems.length);
    const normalized = {
      id: typeof post.id === "string" ? post.id : randomUUID(),
      title: typeof post.title === "string" ? post.title.trim() : "",
      content: typeof post.content === "string" ? post.content.trim() : "",
      category: ["discussion", "resource", "help"].includes(post.category) ? post.category : "discussion",
      authorId: typeof post.authorId === "string" ? post.authorId : "",
      score: Number.isFinite(post.score) ? Number(post.score) : 1,
      comments,
      commentItems,
      createdAt,
      updatedAt
    };

    if (
      normalized.id !== post.id ||
      normalized.title !== post.title ||
      normalized.content !== post.content ||
      normalized.category !== post.category ||
      normalized.authorId !== post.authorId ||
      normalized.score !== post.score ||
      normalized.comments !== post.comments ||
      JSON.stringify(normalized.commentItems) !== JSON.stringify(sourceCommentItems) ||
      normalized.createdAt !== post.createdAt ||
      normalized.updatedAt !== post.updatedAt
    ) {
      changed = true;
    }

    return normalized;
  });

  const postsByAuthor = new Map();
  for (const post of safePosts) {
    postsByAuthor.set(post.authorId, (postsByAuthor.get(post.authorId) ?? 0) + 1);
  }

  const safeUsers = sourceUsers.map((user) => {
    const createdAt = isValidIsoDate(user.createdAt) ? user.createdAt : new Date().toISOString();
    const lastActiveAt = isValidIsoDate(user.lastActiveAt) ? user.lastActiveAt : createdAt;
    const postsCount = postsByAuthor.get(user.id) ?? 0;

    const normalized = {
      id: typeof user.id === "string" ? user.id : randomUUID(),
      username: typeof user.username === "string" ? user.username.trim() : "",
      passwordHash: typeof user.passwordHash === "string" ? user.passwordHash : "",
      reputation: Number.isFinite(user.reputation) ? Number(user.reputation) : 10 + postsCount * 10,
      activityScore: Number.isFinite(user.activityScore) ? Number(user.activityScore) : postsCount * 2,
      createdAt,
      lastActiveAt
    };

    if (
      normalized.id !== user.id ||
      normalized.username !== user.username ||
      normalized.passwordHash !== user.passwordHash ||
      normalized.reputation !== user.reputation ||
      normalized.activityScore !== user.activityScore ||
      normalized.createdAt !== user.createdAt ||
      normalized.lastActiveAt !== user.lastActiveAt ||
      Object.prototype.hasOwnProperty.call(user, "email")
    ) {
      changed = true;
    }

    return normalized;
  });

  const validUserIds = new Set(safeUsers.map((user) => user.id));
  const filteredPosts = safePosts.filter((post) => validUserIds.has(post.authorId));
  if (filteredPosts.length !== safePosts.length) {
    changed = true;
  }

  return {
    changed,
    store: {
      users: safeUsers,
      posts: filteredPosts
    }
  };
}

async function writeStore(store) {
  await fs.writeFile(storePath, JSON.stringify(store, null, 2), "utf8");
}

async function readStore() {
  const raw = await fs.readFile(storePath, "utf8");
  const parsed = JSON.parse(raw);
  const normalized = buildNormalizedStore(parsed);

  if (normalized.changed) {
    await writeStore(normalized.store);
  }

  return normalized.store;
}

function createToken(userId) {
  return jwt.sign({ userId }, JWT_SECRET, { expiresIn: "7d" });
}

function touchDailyActivity(user) {
  const today = getTodayStamp();
  const last = isValidIsoDate(user.lastActiveAt) ? user.lastActiveAt.slice(0, 10) : "";

  if (today !== last) {
    user.activityScore += 1;
    user.reputation += 2;
  }

  user.lastActiveAt = new Date().toISOString();
}

function applyPostContribution(user) {
  user.activityScore += 3;
  user.reputation += 12;
  user.lastActiveAt = new Date().toISOString();
}

function applyCommentContribution(user) {
  user.activityScore += 2;
  user.reputation += 4;
  user.lastActiveAt = new Date().toISOString();
}

function authMiddleware(req, res, next) {
  const authHeader = req.headers.authorization || "";
  const [scheme, token] = authHeader.split(" ");

  if (scheme !== "Bearer" || !token) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  try {
    const payload = jwt.verify(token, JWT_SECRET);
    req.userId = payload.userId;
    return next();
  } catch {
    return res.status(401).json({ error: "Invalid token" });
  }
}

function mapPostForClient(post, users) {
  const author = users.find((user) => user.id === post.authorId);
  const commentItems = Array.isArray(post.commentItems) ? post.commentItems : [];
  const commentCount = Math.max(Number(post.comments) || 0, commentItems.length);

  return {
    id: post.id,
    title: post.title,
    content: post.content,
    category: post.category,
    author: author ? author.username : "Unknown",
    authorId: post.authorId,
    authorReputation: author ? author.reputation : 0,
    comments: commentCount,
    score: post.score,
    createdAt: post.createdAt,
    updatedAt: post.updatedAt
  };
}

app.get("/api/health", (_req, res) => {
  res.json({ status: "ok" });
});

app.post("/api/auth/register", async (req, res) => {
  const { username, password } = req.body ?? {};

  if (!username || !password) {
    return res.status(400).json({ error: "username and password are required" });
  }

  const normalizedUsername = String(username).trim();
  if (!normalizedUsername) {
    return res.status(400).json({ error: "username cannot be empty" });
  }

  if (String(password).length < 6) {
    return res.status(400).json({ error: "password must have at least 6 characters" });
  }

  const store = await readStore();
  const userExists = store.users.some(
    (user) => user.username.toLowerCase() === normalizedUsername.toLowerCase()
  );

  if (userExists) {
    return res.status(409).json({ error: "That username is already taken" });
  }

  const passwordHash = await bcrypt.hash(String(password), 10);
  const now = new Date().toISOString();

  const user = {
    id: randomUUID(),
    username: normalizedUsername,
    passwordHash,
    reputation: 10,
    activityScore: 1,
    createdAt: now,
    lastActiveAt: now
  };

  store.users.push(user);
  await writeStore(store);

  const token = createToken(user.id);
  return res.status(201).json({ token, user: userPublicFields(user) });
});

app.post("/api/auth/login", async (req, res) => {
  const { username, password } = req.body ?? {};

  if (!username || !password) {
    return res.status(400).json({ error: "username and password are required" });
  }

  const normalizedUsername = String(username).trim().toLowerCase();

  const store = await readStore();
  const user = store.users.find((candidate) => candidate.username.toLowerCase() === normalizedUsername);

  if (!user) {
    return res.status(401).json({ error: "Invalid credentials" });
  }

  const passwordMatches = await bcrypt.compare(String(password), user.passwordHash);
  if (!passwordMatches) {
    return res.status(401).json({ error: "Invalid credentials" });
  }

  touchDailyActivity(user);
  await writeStore(store);

  const token = createToken(user.id);
  return res.json({ token, user: userPublicFields(user) });
});

app.get("/api/auth/me", authMiddleware, async (req, res) => {
  const store = await readStore();
  const user = store.users.find((candidate) => candidate.id === req.userId);

  if (!user) {
    return res.status(404).json({ error: "User not found" });
  }

  return res.json({ user: userPublicFields(user) });
});

app.get("/api/users/leaderboard", async (_req, res) => {
  const store = await readStore();
  const users = store.users
    .slice()
    .sort((a, b) => b.reputation - a.reputation)
    .map((user) => userPublicFields(user));

  return res.json({ users });
});

app.get("/api/posts", async (_req, res) => {
  const store = await readStore();
  const posts = store.posts
    .slice()
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
    .map((post) => mapPostForClient(post, store.users));

  return res.json({ posts });
});

app.post("/api/posts", authMiddleware, async (req, res) => {
  const { title, content, category } = req.body ?? {};

  if (!title || !content || !category) {
    return res.status(400).json({ error: "title, content and category are required" });
  }

  const allowedCategories = ["discussion", "resource", "help"];
  if (!allowedCategories.includes(category)) {
    return res.status(400).json({ error: "Invalid category" });
  }

  const store = await readStore();
  const user = store.users.find((candidate) => candidate.id === req.userId);

  if (!user) {
    return res.status(404).json({ error: "User not found" });
  }

  const now = new Date().toISOString();
  const post = {
    id: randomUUID(),
    title: String(title).trim(),
    content: String(content).trim(),
    category,
    authorId: user.id,
    score: 1,
    comments: 0,
    commentItems: [],
    createdAt: now,
    updatedAt: now
  };

  applyPostContribution(user);
  store.posts.push(post);
  await writeStore(store);

  return res.status(201).json({ post: mapPostForClient(post, store.users), user: userPublicFields(user) });
});

app.get("/api/posts/:id/comments", async (req, res) => {
  const { id } = req.params;
  const store = await readStore();
  const post = store.posts.find((candidate) => candidate.id === id);

  if (!post) {
    return res.status(404).json({ error: "Post not found" });
  }

  const commentItems = Array.isArray(post.commentItems) ? post.commentItems : [];
  const comments = commentItems
    .slice()
    .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime())
    .map((comment) => mapCommentForClient(comment, store.users));

  return res.json({ comments });
});

app.post("/api/posts/:id/comments", authMiddleware, async (req, res) => {
  const { id } = req.params;
  const { content } = req.body ?? {};

  if (!content || !String(content).trim()) {
    return res.status(400).json({ error: "content is required" });
  }

  const store = await readStore();
  const post = store.posts.find((candidate) => candidate.id === id);
  if (!post) {
    return res.status(404).json({ error: "Post not found" });
  }

  const user = store.users.find((candidate) => candidate.id === req.userId);
  if (!user) {
    return res.status(404).json({ error: "User not found" });
  }

  if (!Array.isArray(post.commentItems)) {
    post.commentItems = [];
  }

  const comment = {
    id: randomUUID(),
    authorId: user.id,
    content: String(content).trim(),
    createdAt: new Date().toISOString()
  };

  post.commentItems.push(comment);
  post.comments = Math.max(Number(post.comments) || 0, post.commentItems.length);
  post.updatedAt = new Date().toISOString();

  applyCommentContribution(user);
  await writeStore(store);

  return res.status(201).json({
    comment: mapCommentForClient(comment, store.users),
    comments: post.comments,
    user: userPublicFields(user)
  });
});

app.delete("/api/posts/:id", authMiddleware, async (req, res) => {
  const { id } = req.params;
  const store = await readStore();

  const post = store.posts.find((candidate) => candidate.id === id);
  if (!post) {
    return res.status(404).json({ error: "Post not found" });
  }

  if (post.authorId !== req.userId) {
    return res.status(403).json({ error: "You can only delete your own posts" });
  }

  store.posts = store.posts.filter((candidate) => candidate.id !== id);
  await writeStore(store);

  return res.status(204).send();
});

app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(500).json({ error: "Unexpected server error" });
});

app.listen(PORT, () => {
  console.log(`Backend running at http://localhost:${PORT}`);
});
