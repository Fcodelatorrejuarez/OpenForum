import cors from "cors";
import express from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import fs from "node:fs/promises";
import path from "node:path";
import { randomBytes, randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const storePath = path.join(__dirname, "data", "store.json");

const app = express();
const PORT = Number(process.env.PORT ?? 4000);
const IS_PRODUCTION = process.env.NODE_ENV === "production";
const FRONTEND_ORIGIN = process.env.FRONTEND_ORIGIN ?? "http://localhost:5173";
const AUTH_COOKIE_NAME = "clubdelaia_session";
const TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const ALLOWED_POST_CATEGORIES = ["discussion", "resource", "help"];
const DEFAULT_SUBFORUM = {
  id: "clubdelaia-general",
  name: "ClubDeLaIA",
  slug: "clubdelaia",
  description: "Main community for practical AI and web development topics"
};

function resolveJwtSecret() {
  const configured = process.env.JWT_SECRET?.trim() ?? "";
  if (configured) {
    if (configured.length < 32) {
      throw new Error("JWT_SECRET must be at least 32 characters long");
    }
    return configured;
  }

  if (IS_PRODUCTION) {
    throw new Error("JWT_SECRET is required in production");
  }

  const ephemeralSecret = randomBytes(48).toString("hex");
  console.warn("JWT_SECRET not set. Using an ephemeral development secret.");
  return ephemeralSecret;
}

const JWT_SECRET = resolveJwtSecret();

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

const rateLimitBuckets = new Map();

app.set("trust proxy", 1);
app.use(
  cors({
    origin: [FRONTEND_ORIGIN],
    credentials: true
  })
);
app.use((req, res, next) => {
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Cross-Origin-Opener-Policy", "same-origin");
  next();
});
app.use(express.json({ limit: "32kb" }));

function asyncHandler(handler) {
  return (req, res, next) => {
    Promise.resolve(handler(req, res, next)).catch(next);
  };
}

function isValidIsoDate(value) {
  return typeof value === "string" && !Number.isNaN(new Date(value).getTime());
}

function getTodayStamp() {
  return new Date().toISOString().slice(0, 10);
}

function slugify(value) {
  return String(value)
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

function uniqueSubforumSlug(base, usedSlugs) {
  const raw = slugify(base) || "community";
  if (!usedSlugs.has(raw)) {
    usedSlugs.add(raw);
    return raw;
  }

  let suffix = 2;
  while (usedSlugs.has(`${raw}-${suffix}`)) {
    suffix += 1;
  }

  const unique = `${raw}-${suffix}`;
  usedSlugs.add(unique);
  return unique;
}

function requirePlainObject(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new HttpError(400, "Request body must be a JSON object");
  }
  return value;
}

function readString(value, fieldName) {
  if (typeof value !== "string") {
    throw new HttpError(400, `${fieldName} must be a string`);
  }
  return value;
}

function readTrimmedString(value, fieldName) {
  const trimmed = readString(value, fieldName).trim();
  if (!trimmed) {
    throw new HttpError(400, `${fieldName} is required`);
  }
  return trimmed;
}

function validateUsername(value) {
  const username = readTrimmedString(value, "username");
  if (!/^[a-zA-Z0-9_]{3,24}$/.test(username)) {
    throw new HttpError(400, "username must be 3-24 chars and use only letters, numbers, or underscore");
  }
  return username;
}

function validatePasswordForRegister(value) {
  const password = readString(value, "password");
  if (password.length < 8 || password.length > 72) {
    throw new HttpError(400, "password must be between 8 and 72 characters");
  }
  if (!/[A-Za-z]/.test(password) || !/[0-9]/.test(password)) {
    throw new HttpError(400, "password must include at least one letter and one number");
  }
  return password;
}

function validatePasswordForLogin(value) {
  const password = readString(value, "password");
  if (!password || password.length > 72) {
    throw new HttpError(400, "password is invalid");
  }
  return password;
}

function validateSubforumName(value) {
  const name = readTrimmedString(value, "name");
  if (name.length < 3 || name.length > 40) {
    throw new HttpError(400, "name must be between 3 and 40 characters");
  }
  return name;
}

function validateSubforumDescription(value) {
  if (value == null || value === "") {
    return "";
  }
  const description = readString(value, "description").trim();
  if (description.length > 240) {
    throw new HttpError(400, "description must have at most 240 characters");
  }
  return description;
}

function validatePostTitle(value) {
  const title = readTrimmedString(value, "title");
  if (title.length < 4 || title.length > 160) {
    throw new HttpError(400, "title must be between 4 and 160 characters");
  }
  return title;
}

function validatePostContent(value) {
  const content = readTrimmedString(value, "content");
  if (content.length < 3 || content.length > 5000) {
    throw new HttpError(400, "content must be between 3 and 5000 characters");
  }
  return content;
}

function validatePostCategory(value) {
  const category = readTrimmedString(value, "category");
  if (!ALLOWED_POST_CATEGORIES.includes(category)) {
    throw new HttpError(400, "Invalid category");
  }
  return category;
}

function validateSubforumId(value) {
  const subforumId = readTrimmedString(value, "subforumId");
  if (subforumId.length > 120) {
    throw new HttpError(400, "subforumId is invalid");
  }
  return subforumId;
}

function validateCommentContent(value) {
  const content = readTrimmedString(value, "content");
  if (content.length > 1000) {
    throw new HttpError(400, "content must have at most 1000 characters");
  }
  return content;
}

function parseCookies(headerValue) {
  const header = typeof headerValue === "string" ? headerValue : "";
  return header.split(";").reduce((cookies, part) => {
    const [rawName, ...rawValue] = part.trim().split("=");
    if (!rawName) {
      return cookies;
    }
    cookies[rawName] = decodeURIComponent(rawValue.join("="));
    return cookies;
  }, {});
}

function getClientIp(req) {
  const forwarded = req.headers["x-forwarded-for"];
  if (typeof forwarded === "string" && forwarded.trim()) {
    return forwarded.split(",")[0].trim();
  }
  return req.ip || req.socket.remoteAddress || "unknown";
}

function createRateLimiter({ key, windowMs, max, message }) {
  return (req, res, next) => {
    const bucketKey = `${key}:${getClientIp(req)}`;
    const now = Date.now();
    const existing = rateLimitBuckets.get(bucketKey);

    if (!existing || existing.resetAt <= now) {
      rateLimitBuckets.set(bucketKey, { count: 1, resetAt: now + windowMs });
      return next();
    }

    if (existing.count >= max) {
      const retryAfterSeconds = Math.ceil((existing.resetAt - now) / 1000);
      res.setHeader("Retry-After", String(retryAfterSeconds));
      return res.status(429).json({ error: message });
    }

    existing.count += 1;
    rateLimitBuckets.set(bucketKey, existing);

    // Opportunistic cleanup to keep the in-memory map bounded.
    if (rateLimitBuckets.size > 500) {
      for (const [storedKey, bucket] of rateLimitBuckets.entries()) {
        if (bucket.resetAt <= now) {
          rateLimitBuckets.delete(storedKey);
        }
      }
    }

    return next();
  };
}

const authRateLimit = createRateLimiter({
  key: "auth",
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: "Too many authentication attempts. Try again later."
});

const writeRateLimit = createRateLimiter({
  key: "write",
  windowMs: 10 * 60 * 1000,
  max: 40,
  message: "Too many write actions. Slow down and try again shortly."
});

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

function mapSubforumForClient(subforum, posts) {
  const postCount = posts.reduce((total, post) => {
    return post.subforumId === subforum.id ? total + 1 : total;
  }, 0);

  return {
    id: subforum.id,
    name: subforum.name,
    slug: subforum.slug,
    description: subforum.description,
    createdAt: subforum.createdAt,
    postCount
  };
}

function buildNormalizedStore(input) {
  const source = input && typeof input === "object" ? input : {};
  const sourceUsers = Array.isArray(source.users) ? source.users : [];
  const sourcePosts = Array.isArray(source.posts) ? source.posts : [];
  const sourceSubforums = Array.isArray(source.subforums) ? source.subforums : [];

  let changed =
    !Array.isArray(source.users) || !Array.isArray(source.posts) || !Array.isArray(source.subforums);

  const usedSubforumIds = new Set();
  const usedSubforumSlugs = new Set();

  const safeSubforums = sourceSubforums.map((subforum) => {
    const createdAt = isValidIsoDate(subforum.createdAt) ? subforum.createdAt : new Date().toISOString();
    const name = typeof subforum.name === "string" ? subforum.name.trim() : "";
    const normalizedName = name || "Untitled";

    let id = typeof subforum.id === "string" && subforum.id.trim() ? subforum.id : randomUUID();
    if (usedSubforumIds.has(id)) {
      id = randomUUID();
    }
    usedSubforumIds.add(id);

    const requestedSlug = typeof subforum.slug === "string" ? subforum.slug : normalizedName;
    const slug = uniqueSubforumSlug(requestedSlug || normalizedName, usedSubforumSlugs);
    const description = typeof subforum.description === "string" ? subforum.description.trim() : "";
    const createdBy = typeof subforum.createdBy === "string" ? subforum.createdBy : "";

    const normalized = {
      id,
      name: normalizedName,
      slug,
      description,
      createdAt,
      createdBy
    };

    if (
      normalized.id !== subforum.id ||
      normalized.name !== subforum.name ||
      normalized.slug !== subforum.slug ||
      normalized.description !== subforum.description ||
      normalized.createdAt !== subforum.createdAt ||
      normalized.createdBy !== subforum.createdBy
    ) {
      changed = true;
    }

    return normalized;
  });

  if (safeSubforums.length === 0) {
    safeSubforums.push({
      ...DEFAULT_SUBFORUM,
      createdAt: new Date().toISOString(),
      createdBy: ""
    });
    changed = true;
  }

  const validSubforumIds = new Set(safeSubforums.map((subforum) => subforum.id));
  const fallbackSubforumId = safeSubforums[0].id;

  const safePosts = sourcePosts.map((post) => {
    const createdAt = isValidIsoDate(post.createdAt) ? post.createdAt : new Date().toISOString();
    const updatedAt = isValidIsoDate(post.updatedAt) ? post.updatedAt : createdAt;
    const sourceCommentItems = Array.isArray(post.commentItems) ? post.commentItems : [];
    const commentItems = sourceCommentItems.map((comment) => normalizeComment(comment));
    const legacyCount = Number.isFinite(post.comments) ? Number(post.comments) : commentItems.length;
    const comments = Math.max(legacyCount, commentItems.length);
    const subforumId =
      typeof post.subforumId === "string" && validSubforumIds.has(post.subforumId)
        ? post.subforumId
        : fallbackSubforumId;

    const normalized = {
      id: typeof post.id === "string" ? post.id : randomUUID(),
      title: typeof post.title === "string" ? post.title.trim() : "",
      content: typeof post.content === "string" ? post.content.trim() : "",
      category: ALLOWED_POST_CATEGORIES.includes(post.category) ? post.category : "discussion",
      subforumId,
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
      normalized.subforumId !== post.subforumId ||
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

  const finalizedSubforums = safeSubforums.map((subforum) => {
    const createdBy = validUserIds.has(subforum.createdBy) ? subforum.createdBy : "";
    if (createdBy !== subforum.createdBy) {
      changed = true;
    }

    return {
      ...subforum,
      createdBy
    };
  });

  return {
    changed,
    store: {
      users: safeUsers,
      posts: filteredPosts,
      subforums: finalizedSubforums
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

function setAuthCookie(res, token) {
  res.cookie(AUTH_COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: IS_PRODUCTION,
    maxAge: TOKEN_TTL_MS,
    path: "/"
  });
}

function clearAuthCookie(res) {
  res.clearCookie(AUTH_COOKIE_NAME, {
    httpOnly: true,
    sameSite: "lax",
    secure: IS_PRODUCTION,
    path: "/"
  });
}

function extractAuthToken(req) {
  const cookies = parseCookies(req.headers.cookie);
  if (cookies[AUTH_COOKIE_NAME]) {
    return cookies[AUTH_COOKIE_NAME];
  }

  const authHeader = req.headers.authorization || "";
  const [scheme, token] = authHeader.split(" ");
  if (scheme === "Bearer" && token) {
    return token;
  }

  return "";
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
  const token = extractAuthToken(req);

  if (!token) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  try {
    const payload = jwt.verify(token, JWT_SECRET);
    req.userId = payload.userId;
    return next();
  } catch {
    return res.status(401).json({ error: "Invalid session" });
  }
}

function mapPostForClient(post, users, subforums) {
  const author = users.find((user) => user.id === post.authorId);
  const subforum =
    subforums.find((candidate) => candidate.id === post.subforumId) ??
    subforums[0] ?? {
      id: post.subforumId || "unknown",
      name: "General",
      slug: "general",
      description: ""
    };
  const commentItems = Array.isArray(post.commentItems) ? post.commentItems : [];
  const commentCount = Math.max(Number(post.comments) || 0, commentItems.length);

  return {
    id: post.id,
    title: post.title,
    content: post.content,
    category: post.category,
    subforumId: subforum.id,
    subforumName: subforum.name,
    subforumSlug: subforum.slug,
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

app.post(
  "/api/auth/register",
  authRateLimit,
  asyncHandler(async (req, res) => {
    const body = requirePlainObject(req.body);
    const username = validateUsername(body.username);
    const password = validatePasswordForRegister(body.password);

    const store = await readStore();
    const userExists = store.users.some((user) => user.username.toLowerCase() === username.toLowerCase());

    if (userExists) {
      throw new HttpError(409, "That username is already taken");
    }

    const passwordHash = await bcrypt.hash(password, 10);
    const now = new Date().toISOString();

    const user = {
      id: randomUUID(),
      username,
      passwordHash,
      reputation: 10,
      activityScore: 1,
      createdAt: now,
      lastActiveAt: now
    };

    store.users.push(user);
    await writeStore(store);

    const token = createToken(user.id);
    setAuthCookie(res, token);
    return res.status(201).json({ user: userPublicFields(user) });
  })
);

app.post(
  "/api/auth/login",
  authRateLimit,
  asyncHandler(async (req, res) => {
    const body = requirePlainObject(req.body);
    const username = validateUsername(body.username).toLowerCase();
    const password = validatePasswordForLogin(body.password);

    const store = await readStore();
    const user = store.users.find((candidate) => candidate.username.toLowerCase() === username);

    if (!user) {
      throw new HttpError(401, "Invalid credentials");
    }

    const passwordMatches = await bcrypt.compare(password, user.passwordHash);
    if (!passwordMatches) {
      throw new HttpError(401, "Invalid credentials");
    }

    touchDailyActivity(user);
    await writeStore(store);

    const token = createToken(user.id);
    setAuthCookie(res, token);
    return res.json({ user: userPublicFields(user) });
  })
);

app.post("/api/auth/logout", (_req, res) => {
  clearAuthCookie(res);
  res.status(204).send();
});

app.get(
  "/api/auth/me",
  authMiddleware,
  asyncHandler(async (req, res) => {
    const store = await readStore();
    const user = store.users.find((candidate) => candidate.id === req.userId);

    if (!user) {
      throw new HttpError(404, "User not found");
    }

    return res.json({ user: userPublicFields(user) });
  })
);

app.get(
  "/api/users/leaderboard",
  asyncHandler(async (_req, res) => {
    const store = await readStore();
    const users = store.users
      .slice()
      .sort((a, b) => b.reputation - a.reputation)
      .map((user) => userPublicFields(user));

    return res.json({ users });
  })
);

app.get(
  "/api/subforums",
  asyncHandler(async (_req, res) => {
    const store = await readStore();
    const subforums = store.subforums.map((subforum) => mapSubforumForClient(subforum, store.posts));

    return res.json({ subforums });
  })
);

app.post(
  "/api/subforums",
  writeRateLimit,
  authMiddleware,
  asyncHandler(async (req, res) => {
    const body = requirePlainObject(req.body);
    const name = validateSubforumName(body.name);
    const description = validateSubforumDescription(body.description);

    const store = await readStore();
    const user = store.users.find((candidate) => candidate.id === req.userId);

    if (!user) {
      throw new HttpError(404, "User not found");
    }

    const nameExists = store.subforums.some((subforum) => subforum.name.toLowerCase() === name.toLowerCase());
    if (nameExists) {
      throw new HttpError(409, "That subforum already exists");
    }

    const usedSlugs = new Set(store.subforums.map((subforum) => subforum.slug));
    const subforum = {
      id: randomUUID(),
      name,
      slug: uniqueSubforumSlug(name, usedSlugs),
      description,
      createdAt: new Date().toISOString(),
      createdBy: user.id
    };

    store.subforums.push(subforum);
    await writeStore(store);

    return res.status(201).json({
      subforum: mapSubforumForClient(subforum, store.posts)
    });
  })
);

app.get(
  "/api/posts",
  asyncHandler(async (req, res) => {
    const store = await readStore();
    const subforumId = typeof req.query.subforumId === "string" ? req.query.subforumId : "";

    if (subforumId && !store.subforums.some((subforum) => subforum.id === subforumId)) {
      throw new HttpError(400, "Invalid subforum");
    }

    const sourcePosts = subforumId
      ? store.posts.filter((post) => post.subforumId === subforumId)
      : store.posts.slice();

    const posts = sourcePosts
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
      .map((post) => mapPostForClient(post, store.users, store.subforums));

    return res.json({ posts });
  })
);

app.post(
  "/api/posts",
  writeRateLimit,
  authMiddleware,
  asyncHandler(async (req, res) => {
    const body = requirePlainObject(req.body);
    const title = validatePostTitle(body.title);
    const content = validatePostContent(body.content);
    const category = validatePostCategory(body.category);
    const subforumId = validateSubforumId(body.subforumId);

    const store = await readStore();
    const user = store.users.find((candidate) => candidate.id === req.userId);

    if (!user) {
      throw new HttpError(404, "User not found");
    }

    const subforum = store.subforums.find((candidate) => candidate.id === subforumId);
    if (!subforum) {
      throw new HttpError(400, "Invalid subforum");
    }

    const now = new Date().toISOString();
    const post = {
      id: randomUUID(),
      title,
      content,
      category,
      subforumId: subforum.id,
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

    return res.status(201).json({
      post: mapPostForClient(post, store.users, store.subforums),
      user: userPublicFields(user)
    });
  })
);

app.get(
  "/api/posts/:id/comments",
  asyncHandler(async (req, res) => {
    const postId = readTrimmedString(req.params.id, "id");
    const store = await readStore();
    const post = store.posts.find((candidate) => candidate.id === postId);

    if (!post) {
      throw new HttpError(404, "Post not found");
    }

    const commentItems = Array.isArray(post.commentItems) ? post.commentItems : [];
    const comments = commentItems
      .slice()
      .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime())
      .map((comment) => mapCommentForClient(comment, store.users));

    return res.json({ comments });
  })
);

app.post(
  "/api/posts/:id/comments",
  writeRateLimit,
  authMiddleware,
  asyncHandler(async (req, res) => {
    const postId = readTrimmedString(req.params.id, "id");
    const body = requirePlainObject(req.body);
    const content = validateCommentContent(body.content);

    const store = await readStore();
    const post = store.posts.find((candidate) => candidate.id === postId);
    if (!post) {
      throw new HttpError(404, "Post not found");
    }

    const user = store.users.find((candidate) => candidate.id === req.userId);
    if (!user) {
      throw new HttpError(404, "User not found");
    }

    if (!Array.isArray(post.commentItems)) {
      post.commentItems = [];
    }

    const comment = {
      id: randomUUID(),
      authorId: user.id,
      content,
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
  })
);

app.delete(
  "/api/posts/:id",
  writeRateLimit,
  authMiddleware,
  asyncHandler(async (req, res) => {
    const postId = readTrimmedString(req.params.id, "id");
    const store = await readStore();

    const post = store.posts.find((candidate) => candidate.id === postId);
    if (!post) {
      throw new HttpError(404, "Post not found");
    }

    if (post.authorId !== req.userId) {
      throw new HttpError(403, "You can only delete your own posts");
    }

    store.posts = store.posts.filter((candidate) => candidate.id !== postId);
    await writeStore(store);

    return res.status(204).send();
  })
);

app.use((err, _req, res, _next) => {
  if (err instanceof HttpError) {
    return res.status(err.status).json({ error: err.message });
  }

  console.error(err);
  return res.status(500).json({ error: "Unexpected server error" });
});

app.listen(PORT, () => {
  console.log(`Backend running at http://localhost:${PORT}`);
});
