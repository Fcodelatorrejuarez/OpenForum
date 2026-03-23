import cors from "cors";
import express from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import fs from "node:fs/promises";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { randomBytes, randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const storePath = path.join(__dirname, "data", "store.json");
const devJwtSecretPath = path.join(__dirname, "data", "dev-jwt-secret.txt");

const app = express();
const PORT = Number(process.env.PORT ?? 4000);
const IS_PRODUCTION = process.env.NODE_ENV === "production";
const FRONTEND_ORIGIN = process.env.FRONTEND_ORIGIN ?? "http://localhost:5173";
const AUTH_COOKIE_NAME = "clubdelaia_session";
const TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const BASE_REPUTATION = 10;
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

  if (existsSync(devJwtSecretPath)) {
    const persisted = readFileSync(devJwtSecretPath, "utf8").trim();
    if (persisted.length >= 32) {
      return persisted;
    }
  }

  const generatedSecret = randomBytes(48).toString("hex");
  mkdirSync(path.dirname(devJwtSecretPath), { recursive: true });
  writeFileSync(devJwtSecretPath, `${generatedSecret}\n`, { encoding: "utf8" });
  console.warn("JWT_SECRET not set. Generated persistent development secret at backend/data/dev-jwt-secret.txt.");
  return generatedSecret;
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

function validateOptionalCommentParentId(value) {
  if (value == null || value === "") {
    return "";
  }

  const parentCommentId = readTrimmedString(value, "parentCommentId");
  if (parentCommentId.length > 120) {
    throw new HttpError(400, "parentCommentId is invalid");
  }

  return parentCommentId;
}

function validateVoteDirection(value) {
  const direction = readTrimmedString(value, "direction");
  if (direction !== "up" && direction !== "down") {
    throw new HttpError(400, "direction must be 'up' or 'down'");
  }
  return direction;
}

function validatePinnedFlag(value) {
  if (typeof value !== "boolean") {
    throw new HttpError(400, "pinned must be a boolean");
  }
  return value;
}

function validateReportReason(value) {
  if (value == null || value === "") {
    return "";
  }

  const reason = readString(value, "reason").trim();
  if (reason.length > 240) {
    throw new HttpError(400, "reason must have at most 240 characters");
  }

  return reason;
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

function userPublicFields(user, options = {}) {
  const includePrivate = Boolean(options.includePrivate);
  const base = {
    id: user.id,
    username: user.username,
    reputation: user.reputation,
    activityScore: user.activityScore,
    createdAt: user.createdAt,
    lastActiveAt: user.lastActiveAt
  };

  if (includePrivate) {
    base.favoritePostIds = Array.isArray(user.favoritePostIds) ? user.favoritePostIds : [];
    base.blockedUserIds = Array.isArray(user.blockedUserIds) ? user.blockedUserIds : [];
  }

  return base;
}

function normalizeVotesByUserId(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }

  return Object.entries(value).reduce((acc, [userId, voteValue]) => {
    if (voteValue === 1 || voteValue === -1) {
      acc[userId] = voteValue;
    }
    return acc;
  }, {});
}

function parseViewerUserId(req) {
  const maybeToken = extractAuthToken(req);
  if (!maybeToken) {
    return "";
  }

  try {
    const payload = jwt.verify(maybeToken, JWT_SECRET);
    return typeof payload?.userId === "string" ? payload.userId : "";
  } catch {
    return "";
  }
}

function getBlockedUserIdSet(store, viewerUserId) {
  if (!viewerUserId) {
    return new Set();
  }
  const viewer = store.users.find((candidate) => candidate.id === viewerUserId);
  if (!viewer) {
    return new Set();
  }
  return new Set(Array.isArray(viewer.blockedUserIds) ? viewer.blockedUserIds : []);
}

function sanitizeBlockedUserIds(value, validUserIds) {
  if (!Array.isArray(value)) {
    return [];
  }

  const unique = new Set();
  for (const userId of value) {
    if (typeof userId !== "string") {
      continue;
    }
    if (!validUserIds.has(userId)) {
      continue;
    }
    unique.add(userId);
  }

  return [...unique];
}

function isSubforumModerator(subforum, userId) {
  return Boolean(subforum && userId && subforum.createdBy === userId);
}

function extractMentions(text) {
  if (typeof text !== "string") {
    return [];
  }

  const mentions = new Set();
  const pattern = /(^|[^A-Za-z0-9_])@([A-Za-z0-9_]{3,24})/g;
  let match = pattern.exec(text);

  while (match) {
    mentions.add(match[2].toLowerCase());
    match = pattern.exec(text);
  }

  return [...mentions];
}

function queueNotification(store, input) {
  const userId = typeof input?.userId === "string" ? input.userId : "";
  const actorUserId = typeof input?.actorUserId === "string" ? input.actorUserId : "";
  if (!userId || !actorUserId || userId === actorUserId) {
    return null;
  }

  const userExists = store.users.some((user) => user.id === userId);
  if (!userExists) {
    return null;
  }

  const notification = {
    id: randomUUID(),
    userId,
    actorUserId,
    type: typeof input?.type === "string" ? input.type : "activity",
    postId: typeof input?.postId === "string" ? input.postId : "",
    commentId: typeof input?.commentId === "string" ? input.commentId : "",
    message: typeof input?.message === "string" ? input.message : "Nueva actividad",
    createdAt: new Date().toISOString(),
    readAt: ""
  };

  if (!Array.isArray(store.notifications)) {
    store.notifications = [];
  }
  store.notifications.push(notification);
  return notification;
}

function normalizeNotification(notification) {
  const createdAt = isValidIsoDate(notification?.createdAt) ? notification.createdAt : new Date().toISOString();
  const readAt = isValidIsoDate(notification?.readAt) ? notification.readAt : "";
  return {
    id: typeof notification?.id === "string" ? notification.id : randomUUID(),
    userId: typeof notification?.userId === "string" ? notification.userId : "",
    actorUserId: typeof notification?.actorUserId === "string" ? notification.actorUserId : "",
    type: typeof notification?.type === "string" ? notification.type : "activity",
    postId: typeof notification?.postId === "string" ? notification.postId : "",
    commentId: typeof notification?.commentId === "string" ? notification.commentId : "",
    message: typeof notification?.message === "string" ? notification.message.trim() : "",
    createdAt,
    readAt
  };
}

function normalizeReport(report) {
  const createdAt = isValidIsoDate(report?.createdAt) ? report.createdAt : new Date().toISOString();
  const targetType = report?.targetType === "post" || report?.targetType === "comment" ? report.targetType : "post";
  const status = report?.status === "resolved" ? "resolved" : "open";
  return {
    id: typeof report?.id === "string" ? report.id : randomUUID(),
    targetType,
    targetId: typeof report?.targetId === "string" ? report.targetId : "",
    postId: typeof report?.postId === "string" ? report.postId : "",
    reportedBy: typeof report?.reportedBy === "string" ? report.reportedBy : "",
    reason: typeof report?.reason === "string" ? report.reason.trim() : "",
    status,
    createdAt
  };
}

function createCommentNotifications(store, params) {
  const { actor, post, comment, parentCommentId, content } = params;
  const actorId = actor?.id ?? "";
  const actorName = actor?.username ?? "usuario";
  if (!actorId || !post || !comment) {
    return;
  }

  const recipients = new Set();

  if (post.authorId && post.authorId !== actorId) {
    recipients.add(post.authorId);
  }

  if (parentCommentId) {
    const parentComment = findCommentById(post.commentItems ?? [], parentCommentId);
    if (parentComment?.authorId && parentComment.authorId !== actorId) {
      recipients.add(parentComment.authorId);
    }
  }

  const mentionedHandles = extractMentions(content);
  for (const handle of mentionedHandles) {
    const user = store.users.find((candidate) => candidate.username.toLowerCase() === handle);
    if (user && user.id !== actorId) {
      recipients.add(user.id);
    }
  }

  for (const recipientId of recipients) {
    let type = "comment";
    let message = `u/${actorName} comento en una publicacion que sigues`;

    if (parentCommentId) {
      type = "reply";
      message = `u/${actorName} respondio a tu comentario`;
    }

    const mentionTarget = store.users.find((candidate) => candidate.id === recipientId);
    if (mentionTarget && mentionedHandles.includes(mentionTarget.username.toLowerCase())) {
      type = "mention";
      message = `u/${actorName} te menciono en un comentario`;
    }

    queueNotification(store, {
      userId: recipientId,
      actorUserId: actorId,
      type,
      postId: post.id,
      commentId: comment.id,
      message
    });
  }
}

function mapNotificationForClient(notification, users) {
  const actor = users.find((user) => user.id === notification.actorUserId);
  return {
    id: notification.id,
    type: notification.type,
    message: notification.message,
    actorId: notification.actorUserId,
    actorUsername: actor ? actor.username : "desconocido",
    postId: notification.postId,
    commentId: notification.commentId,
    createdAt: notification.createdAt,
    readAt: notification.readAt
  };
}

function applyPostVote(post, voterUserId, direction) {
  post.votesByUserId = normalizeVotesByUserId(post.votesByUserId);

  const previous = post.votesByUserId[voterUserId] ?? 0;
  const next = direction === "up" ? (previous === 1 ? 0 : 1) : previous === -1 ? 0 : -1;

  if (next === 0) {
    delete post.votesByUserId[voterUserId];
  } else {
    post.votesByUserId[voterUserId] = next;
  }

  const voteDelta = Object.values(post.votesByUserId).reduce((total, voteValue) => total + voteValue, 0);
  post.score = 1 + voteDelta;

  return next;
}

function toggleFavoritePost(user, postId) {
  const existing = Array.isArray(user.favoritePostIds) ? user.favoritePostIds : [];
  const current = new Set(existing);

  if (current.has(postId)) {
    current.delete(postId);
  } else {
    current.add(postId);
  }

  user.favoritePostIds = [...current];
  return current.has(postId);
}

function sanitizeFavoritePostIds(value, validPostIds) {
  if (!Array.isArray(value)) {
    return [];
  }

  const unique = new Set();
  for (const postId of value) {
    if (typeof postId !== "string") {
      continue;
    }
    if (!validPostIds.has(postId)) {
      continue;
    }
    unique.add(postId);
  }

  return [...unique];
}

function recalculatePostScore(post) {
  const votesByUserId = normalizeVotesByUserId(post.votesByUserId);
  const voteDelta = Object.values(votesByUserId).reduce((total, voteValue) => total + voteValue, 0);
  post.votesByUserId = votesByUserId;
  post.score = 1 + voteDelta;
  return post.score;
}

function recalculateAllReputations(store) {
  let changed = false;

  for (const user of store.users) {
    const upvotes = store.posts.reduce((total, post) => {
      const commentItems = Array.isArray(post.commentItems) ? post.commentItems : [];
      const commentUpvotes = countCommentUpvotes(commentItems, user.id);
      const postUpvotes = Object.entries(post.votesByUserId ?? {}).reduce((count, [voterId, voteValue]) => {
        if (post.authorId !== user.id) {
          return count;
        }
        return voteValue === 1 && voterId !== user.id ? count + 1 : count;
      }, 0);
      return total + commentUpvotes + postUpvotes;
    }, 0);
    const computedReputation = BASE_REPUTATION + upvotes;
    if (user.reputation !== computedReputation) {
      changed = true;
    }
    user.reputation = computedReputation;
  }

  return changed;
}

function syncFavoritesWithPosts(store) {
  const validPostIds = new Set(store.posts.map((post) => post.id));
  let changed = false;

  for (const user of store.users) {
    const sanitized = sanitizeFavoritePostIds(user.favoritePostIds, validPostIds);
    const current = Array.isArray(user.favoritePostIds) ? user.favoritePostIds : [];
    if (JSON.stringify(sanitized) !== JSON.stringify(current)) {
      user.favoritePostIds = sanitized;
      changed = true;
    }
  }

  return changed;
}

function syncBlockedUsers(store) {
  const validUserIds = new Set(store.users.map((user) => user.id));
  let changed = false;

  for (const user of store.users) {
    const sanitized = sanitizeBlockedUserIds(user.blockedUserIds, validUserIds).filter((id) => id !== user.id);
    const current = Array.isArray(user.blockedUserIds) ? user.blockedUserIds : [];
    if (JSON.stringify(sanitized) !== JSON.stringify(current)) {
      user.blockedUserIds = sanitized;
      changed = true;
    }
  }

  return changed;
}

function syncNotifications(store) {
  const validUserIds = new Set(store.users.map((user) => user.id));
  const validPostIds = new Set(store.posts.map((post) => post.id));
  let changed = false;

  if (!Array.isArray(store.notifications)) {
    store.notifications = [];
    return true;
  }

  const sanitized = store.notifications
    .map((notification) => normalizeNotification(notification))
    .filter((notification) => {
      if (!validUserIds.has(notification.userId)) {
        return false;
      }
      if (!validUserIds.has(notification.actorUserId)) {
        return false;
      }
      if (notification.postId && !validPostIds.has(notification.postId)) {
        return false;
      }
      return true;
    });

  if (JSON.stringify(sanitized) !== JSON.stringify(store.notifications)) {
    changed = true;
    store.notifications = sanitized;
  }

  return changed;
}

function syncReports(store) {
  const validUserIds = new Set(store.users.map((user) => user.id));
  const validPostIds = new Set(store.posts.map((post) => post.id));
  let changed = false;

  if (!Array.isArray(store.reports)) {
    store.reports = [];
    return true;
  }

  const sanitized = store.reports
    .map((report) => normalizeReport(report))
    .filter((report) => {
      if (!validUserIds.has(report.reportedBy)) {
        return false;
      }
      if (report.targetType === "post") {
        return validPostIds.has(report.targetId);
      }
      if (report.targetType === "comment") {
        return report.postId ? validPostIds.has(report.postId) : false;
      }
      return false;
    });

  if (JSON.stringify(sanitized) !== JSON.stringify(store.reports)) {
    changed = true;
    store.reports = sanitized;
  }

  return changed;
}

function recalculateAllPostScores(store) {
  let changed = false;

  for (const post of store.posts) {
    const previousScore = Number.isFinite(post.score) ? Number(post.score) : 1;
    const previousVotes = JSON.stringify(post.votesByUserId ?? {});
    const nextScore = recalculatePostScore(post);
    const nextVotes = JSON.stringify(post.votesByUserId ?? {});
    if (previousScore !== nextScore || previousVotes !== nextVotes) {
      changed = true;
    }
  }

  return changed;
}

function recalculateStoreDerivedFields(store) {
  const scoresChanged = recalculateAllPostScores(store);
  const reputationsChanged = recalculateAllReputations(store);
  const favoritesChanged = syncFavoritesWithPosts(store);
  const blockedChanged = syncBlockedUsers(store);
  const notificationsChanged = syncNotifications(store);
  const reportsChanged = syncReports(store);
  return scoresChanged || reputationsChanged || favoritesChanged || blockedChanged || notificationsChanged || reportsChanged;
}

function userFieldsEqual(left, right) {
  return (
    left.id === right.id &&
    left.username === right.username &&
    left.passwordHash === right.passwordHash &&
    left.reputation === right.reputation &&
    left.activityScore === right.activityScore &&
    left.createdAt === right.createdAt &&
    left.lastActiveAt === right.lastActiveAt &&
    JSON.stringify(left.favoritePostIds ?? []) === JSON.stringify(right.favoritePostIds ?? []) &&
    JSON.stringify(left.blockedUserIds ?? []) === JSON.stringify(right.blockedUserIds ?? [])
  );
}

function postFieldsEqual(left, right, sourceCommentItems) {
  return (
    left.id === right.id &&
    left.title === right.title &&
    left.content === right.content &&
    left.category === right.category &&
    left.subforumId === right.subforumId &&
    left.authorId === right.authorId &&
    left.score === right.score &&
    left.comments === right.comments &&
    left.isPinned === right.isPinned &&
    left.pinnedAt === right.pinnedAt &&
    JSON.stringify(left.commentItems) === JSON.stringify(sourceCommentItems) &&
    JSON.stringify(left.votesByUserId ?? {}) === JSON.stringify(right.votesByUserId ?? {}) &&
    left.createdAt === right.createdAt &&
    left.updatedAt === right.updatedAt
  );
}

function recalculateUserReputationFromCommentUpvotes(store, userId) {
  const user = store.users.find((candidate) => candidate.id === userId);
  if (!user) {
    return;
  }

  const upvotes = store.posts.reduce((total, post) => {
    const commentItems = Array.isArray(post.commentItems) ? post.commentItems : [];
    const commentUpvotes = countCommentUpvotes(commentItems, userId);
    const postUpvotes = Object.entries(post.votesByUserId ?? {}).reduce((count, [voterId, voteValue]) => {
      if (post.authorId !== userId) {
        return count;
      }
      return voteValue === 1 && voterId !== userId ? count + 1 : count;
    }, 0);
    return total + commentUpvotes + postUpvotes;
  }, 0);

  user.reputation = BASE_REPUTATION + upvotes;
}

function normalizeUser(user, postsByAuthor, safePosts) {
  const createdAt = isValidIsoDate(user.createdAt) ? user.createdAt : new Date().toISOString();
  const lastActiveAt = isValidIsoDate(user.lastActiveAt) ? user.lastActiveAt : createdAt;
  const postsCount = postsByAuthor.get(user.id) ?? 0;
  const commentUpvotes = safePosts.reduce((total, post) => {
    const commentItems = Array.isArray(post.commentItems) ? post.commentItems : [];
    return total + countCommentUpvotes(commentItems, user.id);
  }, 0);

  return {
    id: typeof user.id === "string" ? user.id : randomUUID(),
    username: typeof user.username === "string" ? user.username.trim() : "",
    passwordHash: typeof user.passwordHash === "string" ? user.passwordHash : "",
    reputation: BASE_REPUTATION + commentUpvotes,
    activityScore: Number.isFinite(user.activityScore) ? Number(user.activityScore) : postsCount * 2,
    createdAt,
    lastActiveAt,
    favoritePostIds: Array.isArray(user.favoritePostIds) ? user.favoritePostIds.filter((postId) => typeof postId === "string") : [],
    blockedUserIds: Array.isArray(user.blockedUserIds) ? user.blockedUserIds.filter((userId) => typeof userId === "string") : []
  };
}

function normalizeComment(comment) {
  const createdAt = isValidIsoDate(comment.createdAt) ? comment.createdAt : new Date().toISOString();
  const sourceReplies = Array.isArray(comment.replies) ? comment.replies : [];
  const sourceVotes =
    comment && typeof comment.votesByUserId === "object" && !Array.isArray(comment.votesByUserId)
      ? comment.votesByUserId
      : {};
  const votesByUserId = Object.entries(sourceVotes).reduce((acc, [userId, value]) => {
    if (value === 1 || value === -1) {
      acc[userId] = value;
    }
    return acc;
  }, {});

  const voteDelta = Object.values(votesByUserId).reduce((total, value) => total + value, 0);
  const scoreFromVotes = 1 + voteDelta;

  return {
    id: typeof comment.id === "string" ? comment.id : randomUUID(),
    authorId: typeof comment.authorId === "string" ? comment.authorId : "",
    content: typeof comment.content === "string" ? comment.content.trim() : "",
    createdAt,
    score: scoreFromVotes,
    votesByUserId,
    replies: sourceReplies.map((reply) => normalizeComment(reply))
  };
}

function countCommentUpvotes(commentItems, userId) {
  return commentItems.reduce((total, comment) => {
    const ownUpvotes =
      comment.authorId === userId
        ? Object.values(comment.votesByUserId ?? {}).filter((value) => value === 1).length
        : 0;
    return total + ownUpvotes + countCommentUpvotes(Array.isArray(comment.replies) ? comment.replies : [], userId);
  }, 0);
}

function applyCommentVote(comment, voterUserId, direction) {
  if (!comment.votesByUserId || typeof comment.votesByUserId !== "object" || Array.isArray(comment.votesByUserId)) {
    comment.votesByUserId = {};
  }

  const previous = comment.votesByUserId[voterUserId] ?? 0;
  const next = direction === "up" ? (previous === 1 ? 0 : 1) : previous === -1 ? 0 : -1;

  if (next === 0) {
    delete comment.votesByUserId[voterUserId];
  } else {
    comment.votesByUserId[voterUserId] = next;
  }

  const voteDelta = Object.values(comment.votesByUserId).reduce((total, value) => total + value, 0);
  comment.score = 1 + voteDelta;

  return next;
}

function findCommentById(commentItems, commentId) {
  for (const comment of commentItems) {
    if (comment.id === commentId) {
      return comment;
    }

    const nested = findCommentById(Array.isArray(comment.replies) ? comment.replies : [], commentId);
    if (nested) {
      return nested;
    }
  }

  return null;
}

function countCommentsDeep(commentItems) {
  return commentItems.reduce((total, comment) => {
    return total + 1 + countCommentsDeep(Array.isArray(comment.replies) ? comment.replies : []);
  }, 0);
}

function sortCommentsByDate(commentItems) {
  return [...commentItems]
    .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime())
    .map((comment) => ({
      ...comment,
      replies: sortCommentsByDate(Array.isArray(comment.replies) ? comment.replies : [])
    }));
}

function filterCommentTreeByBlockedAuthor(commentItems, blockedAuthorIds) {
  if (!blockedAuthorIds || blockedAuthorIds.size === 0) {
    return commentItems;
  }

  return commentItems
    .filter((comment) => !blockedAuthorIds.has(comment.authorId))
    .map((comment) => ({
      ...comment,
      replies: filterCommentTreeByBlockedAuthor(Array.isArray(comment.replies) ? comment.replies : [], blockedAuthorIds)
    }));
}

function insertReplyIntoTree(commentItems, parentCommentId, newComment) {
  let inserted = false;

  const comments = commentItems.map((comment) => {
    if (comment.id === parentCommentId) {
      inserted = true;
      return {
        ...comment,
        replies: [...(Array.isArray(comment.replies) ? comment.replies : []), newComment]
      };
    }

    if (!Array.isArray(comment.replies) || comment.replies.length === 0) {
      return comment;
    }

    const nested = insertReplyIntoTree(comment.replies, parentCommentId, newComment);
    if (!nested.inserted) {
      return comment;
    }

    inserted = true;
    return {
      ...comment,
      replies: nested.comments
    };
  });

  return { comments, inserted };
}

function mapCommentForClient(comment, users, viewerUserId = "") {
  const author = users.find((user) => user.id === comment.authorId);
  return {
    id: comment.id,
    authorId: comment.authorId,
    author: author ? author.username : "Unknown",
    authorReputation: author ? author.reputation : 0,
    content: comment.content,
    createdAt: comment.createdAt,
    score: Number.isFinite(comment.score) ? Number(comment.score) : 1,
    userVote: viewerUserId ? comment.votesByUserId?.[viewerUserId] ?? 0 : 0,
    replies: Array.isArray(comment.replies)
      ? comment.replies.map((reply) => mapCommentForClient(reply, users, viewerUserId))
      : []
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
  const sourceNotifications = Array.isArray(source.notifications) ? source.notifications : [];
  const sourceReports = Array.isArray(source.reports) ? source.reports : [];

  let changed =
    !Array.isArray(source.users) ||
    !Array.isArray(source.posts) ||
    !Array.isArray(source.subforums) ||
    !Array.isArray(source.notifications) ||
    !Array.isArray(source.reports);

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
    const normalizedCount = countCommentsDeep(commentItems);
    const legacyCount = Number.isFinite(post.comments) ? Number(post.comments) : normalizedCount;
    const comments = Math.max(legacyCount, normalizedCount);
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
      score: 1,
      comments,
      commentItems,
      votesByUserId: normalizeVotesByUserId(post.votesByUserId),
      isPinned: Boolean(post.isPinned),
      pinnedAt: isValidIsoDate(post.pinnedAt) ? post.pinnedAt : "",
      createdAt,
      updatedAt
    };
    recalculatePostScore(normalized);

    if (!postFieldsEqual(normalized, post, sourceCommentItems)) {
      changed = true;
    }

    return normalized;
  });

  const postsByAuthor = new Map();
  for (const post of safePosts) {
    postsByAuthor.set(post.authorId, (postsByAuthor.get(post.authorId) ?? 0) + 1);
  }

  const safeUsers = sourceUsers.map((user) => {
    const normalized = normalizeUser(user, postsByAuthor, safePosts);
    if (!userFieldsEqual(normalized, user) || Object.prototype.hasOwnProperty.call(user, "email")) {
      changed = true;
    }
    return normalized;
  });

  const validUserIds = new Set(safeUsers.map((user) => user.id));
  const filteredPosts = safePosts
    .filter((post) => validUserIds.has(post.authorId))
    .map((post) => {
      const votesByUserId = Object.entries(post.votesByUserId ?? {}).reduce((acc, [voterId, voteValue]) => {
        if (!validUserIds.has(voterId)) {
          return acc;
        }
        if (voteValue === 1 || voteValue === -1) {
          acc[voterId] = voteValue;
        }
        return acc;
      }, {});
      const next = {
        ...post,
        votesByUserId
      };

      if (next.isPinned && !next.pinnedAt) {
        next.pinnedAt = next.updatedAt;
        changed = true;
      }
      if (!next.isPinned && next.pinnedAt) {
        next.pinnedAt = "";
        changed = true;
      }

      recalculatePostScore(next);
      if (JSON.stringify(post.votesByUserId ?? {}) !== JSON.stringify(votesByUserId)) {
        changed = true;
      }
      return next;
    });
  if (filteredPosts.length !== safePosts.length) {
    changed = true;
  }

  const validPostIds = new Set(filteredPosts.map((post) => post.id));
  const finalizedUsers = safeUsers.map((user) => {
    const favoritePostIds = sanitizeFavoritePostIds(user.favoritePostIds, validPostIds);
    const blockedUserIds = sanitizeBlockedUserIds(user.blockedUserIds, validUserIds).filter((id) => id !== user.id);
    if (JSON.stringify(favoritePostIds) !== JSON.stringify(user.favoritePostIds ?? [])) {
      changed = true;
    }
    if (JSON.stringify(blockedUserIds) !== JSON.stringify(user.blockedUserIds ?? [])) {
      changed = true;
    }
    return {
      ...user,
      favoritePostIds,
      blockedUserIds
    };
  });

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

  const normalizedStore = {
    users: finalizedUsers,
    posts: filteredPosts,
    subforums: finalizedSubforums,
    notifications: sourceNotifications.map((notification) => normalizeNotification(notification)),
    reports: sourceReports.map((report) => normalizeReport(report))
  };

  if (recalculateStoreDerivedFields(normalizedStore)) {
    changed = true;
  }

  return {
    changed,
    store: normalizedStore
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
  }

  user.lastActiveAt = new Date().toISOString();
}

function applyPostContribution(user) {
  user.activityScore += 3;
  user.lastActiveAt = new Date().toISOString();
}

function applyCommentContribution(user) {
  user.activityScore += 2;
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

function mapPostForClient(post, users, subforums, viewerUserId = "") {
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
  const commentCount = Math.max(Number(post.comments) || 0, countCommentsDeep(commentItems));

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
    userVote: viewerUserId ? post.votesByUserId?.[viewerUserId] ?? 0 : 0,
    isPinned: Boolean(post.isPinned),
    pinnedAt: typeof post.pinnedAt === "string" ? post.pinnedAt : "",
    canPin: isSubforumModerator(subforum, viewerUserId),
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
      reputation: BASE_REPUTATION,
      activityScore: 1,
      favoritePostIds: [],
      blockedUserIds: [],
      createdAt: now,
      lastActiveAt: now
    };

    store.users.push(user);
    await writeStore(store);

    const token = createToken(user.id);
    setAuthCookie(res, token);
    return res.status(201).json({ user: userPublicFields(user, { includePrivate: true }) });
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
    return res.json({ user: userPublicFields(user, { includePrivate: true }) });
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

    return res.json({ user: userPublicFields(user, { includePrivate: true }) });
  })
);

app.get(
  "/api/notifications",
  authMiddleware,
  asyncHandler(async (req, res) => {
    const store = await readStore();
    const user = store.users.find((candidate) => candidate.id === req.userId);
    if (!user) {
      throw new HttpError(404, "User not found");
    }

    const blockedUserIds = new Set(Array.isArray(user.blockedUserIds) ? user.blockedUserIds : []);
    const notifications = (Array.isArray(store.notifications) ? store.notifications : [])
      .filter((notification) => notification.userId === user.id)
      .filter((notification) => !blockedUserIds.has(notification.actorUserId))
      .sort((a, b) => {
        const unreadDiff = Number(Boolean(a.readAt)) - Number(Boolean(b.readAt));
        if (unreadDiff !== 0) {
          return unreadDiff;
        }
        return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
      })
      .map((notification) => mapNotificationForClient(notification, store.users));

    const unreadCount = notifications.filter((notification) => !notification.readAt).length;
    return res.json({ notifications, unreadCount });
  })
);

app.post(
  "/api/notifications/read-all",
  writeRateLimit,
  authMiddleware,
  asyncHandler(async (req, res) => {
    const store = await readStore();
    const now = new Date().toISOString();

    let updated = false;
    for (const notification of Array.isArray(store.notifications) ? store.notifications : []) {
      if (notification.userId === req.userId && !notification.readAt) {
        notification.readAt = now;
        updated = true;
      }
    }

    if (updated) {
      await writeStore(store);
    }

    return res.status(204).send();
  })
);

app.post(
  "/api/notifications/:id/read",
  writeRateLimit,
  authMiddleware,
  asyncHandler(async (req, res) => {
    const notificationId = readTrimmedString(req.params.id, "id");
    const store = await readStore();
    const notification = (Array.isArray(store.notifications) ? store.notifications : []).find(
      (candidate) => candidate.id === notificationId && candidate.userId === req.userId
    );

    if (!notification) {
      throw new HttpError(404, "Notification not found");
    }

    if (!notification.readAt) {
      notification.readAt = new Date().toISOString();
      await writeStore(store);
    }

    return res.status(204).send();
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

app.post(
  "/api/users/:id/block",
  writeRateLimit,
  authMiddleware,
  asyncHandler(async (req, res) => {
    const targetUserId = readTrimmedString(req.params.id, "id");
    const store = await readStore();
    const currentUser = store.users.find((candidate) => candidate.id === req.userId);
    if (!currentUser) {
      throw new HttpError(404, "User not found");
    }

    if (targetUserId === currentUser.id) {
      throw new HttpError(400, "You cannot block yourself");
    }

    const targetUser = store.users.find((candidate) => candidate.id === targetUserId);
    if (!targetUser) {
      throw new HttpError(404, "Target user not found");
    }

    const current = new Set(Array.isArray(currentUser.blockedUserIds) ? currentUser.blockedUserIds : []);
    if (current.has(targetUserId)) {
      current.delete(targetUserId);
    } else {
      current.add(targetUserId);
    }

    currentUser.blockedUserIds = [...current];
    currentUser.lastActiveAt = new Date().toISOString();
    await writeStore(store);

    return res.json({
      blocked: current.has(targetUserId),
      blockedUserIds: currentUser.blockedUserIds,
      user: userPublicFields(currentUser, { includePrivate: true })
    });
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
    const viewerUserId = parseViewerUserId(req);
    const blockedAuthorIds = getBlockedUserIdSet(store, viewerUserId);
    const subforumId = typeof req.query.subforumId === "string" ? req.query.subforumId : "";

    if (subforumId && !store.subforums.some((subforum) => subforum.id === subforumId)) {
      throw new HttpError(400, "Invalid subforum");
    }

    const sourcePosts = subforumId
      ? store.posts.filter((post) => post.subforumId === subforumId)
      : store.posts.slice();

    const posts = sourcePosts
      .filter((post) => !blockedAuthorIds.has(post.authorId))
      .sort((a, b) => {
        const pinnedDiff = Number(Boolean(b.isPinned)) - Number(Boolean(a.isPinned));
        if (pinnedDiff !== 0) {
          return pinnedDiff;
        }

        const pinnedDateDiff =
          new Date(b.pinnedAt || 0).getTime() - new Date(a.pinnedAt || 0).getTime();
        if (pinnedDateDiff !== 0) {
          return pinnedDateDiff;
        }

        return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
      })
      .map((post) => mapPostForClient(post, store.users, store.subforums, viewerUserId));

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
      votesByUserId: {},
      isPinned: false,
      pinnedAt: "",
      comments: 0,
      commentItems: [],
      createdAt: now,
      updatedAt: now
    };

    applyPostContribution(user);
    store.posts.push(post);
    await writeStore(store);

    return res.status(201).json({
      post: mapPostForClient(post, store.users, store.subforums, req.userId),
      user: userPublicFields(user, { includePrivate: true })
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
    const viewerUserId = parseViewerUserId(req);
    const blockedAuthorIds = getBlockedUserIdSet(store, viewerUserId);
    const visibleCommentItems = filterCommentTreeByBlockedAuthor(commentItems, blockedAuthorIds);

    const comments = sortCommentsByDate(visibleCommentItems).map((comment) =>
      mapCommentForClient(comment, store.users, viewerUserId)
    );

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
    const parentCommentId = validateOptionalCommentParentId(body.parentCommentId);

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
      createdAt: new Date().toISOString(),
      score: 1,
      votesByUserId: {},
      replies: []
    };

    if (parentCommentId) {
      const result = insertReplyIntoTree(post.commentItems, parentCommentId, comment);
      if (!result.inserted) {
        throw new HttpError(404, "Parent comment not found");
      }
      post.commentItems = result.comments;
    } else {
      post.commentItems.push(comment);
    }

    post.comments = countCommentsDeep(post.commentItems);
    post.updatedAt = new Date().toISOString();

    applyCommentContribution(user);
    createCommentNotifications(store, {
      actor: user,
      post,
      comment,
      parentCommentId,
      content
    });
    await writeStore(store);

    return res.status(201).json({
      comment: mapCommentForClient(comment, store.users, req.userId),
      comments: post.comments,
      user: userPublicFields(user, { includePrivate: true })
    });
  })
);

app.post(
  "/api/posts/:id/vote",
  writeRateLimit,
  authMiddleware,
  asyncHandler(async (req, res) => {
    const postId = readTrimmedString(req.params.id, "id");
    const body = requirePlainObject(req.body);
    const direction = validateVoteDirection(body.direction);

    const store = await readStore();
    const post = store.posts.find((candidate) => candidate.id === postId);
    if (!post) {
      throw new HttpError(404, "Post not found");
    }

    const voter = store.users.find((candidate) => candidate.id === req.userId);
    if (!voter) {
      throw new HttpError(404, "User not found");
    }

    applyPostVote(post, req.userId, direction);
    post.updatedAt = new Date().toISOString();

    if (post.authorId) {
      recalculateUserReputationFromCommentUpvotes(store, post.authorId);
    }

    voter.lastActiveAt = new Date().toISOString();
    await writeStore(store);

    return res.json({
      post: mapPostForClient(post, store.users, store.subforums, req.userId),
      user: userPublicFields(voter, { includePrivate: true })
    });
  })
);

app.post(
  "/api/posts/:id/favorite",
  writeRateLimit,
  authMiddleware,
  asyncHandler(async (req, res) => {
    const postId = readTrimmedString(req.params.id, "id");
    const store = await readStore();
    const post = store.posts.find((candidate) => candidate.id === postId);
    if (!post) {
      throw new HttpError(404, "Post not found");
    }

    const user = store.users.find((candidate) => candidate.id === req.userId);
    if (!user) {
      throw new HttpError(404, "User not found");
    }

    const favorited = toggleFavoritePost(user, postId);
    user.lastActiveAt = new Date().toISOString();
    await writeStore(store);

    return res.json({
      favorited,
      favoritePostIds: user.favoritePostIds,
      user: userPublicFields(user, { includePrivate: true })
    });
  })
);

app.post(
  "/api/posts/:id/report",
  writeRateLimit,
  authMiddleware,
  asyncHandler(async (req, res) => {
    const postId = readTrimmedString(req.params.id, "id");
    const body = requirePlainObject(req.body);
    const reason = validateReportReason(body.reason);
    const store = await readStore();

    const post = store.posts.find((candidate) => candidate.id === postId);
    if (!post) {
      throw new HttpError(404, "Post not found");
    }

    const reporter = store.users.find((candidate) => candidate.id === req.userId);
    if (!reporter) {
      throw new HttpError(404, "User not found");
    }

    const alreadyReported = (Array.isArray(store.reports) ? store.reports : []).some(
      (report) =>
        report.targetType === "post" &&
        report.targetId === postId &&
        report.reportedBy === reporter.id &&
        report.status === "open"
    );

    if (alreadyReported) {
      throw new HttpError(409, "You already reported this post");
    }

    if (!Array.isArray(store.reports)) {
      store.reports = [];
    }

    const report = {
      id: randomUUID(),
      targetType: "post",
      targetId: post.id,
      postId: post.id,
      reportedBy: reporter.id,
      reason,
      status: "open",
      createdAt: new Date().toISOString()
    };

    store.reports.push(report);
    await writeStore(store);

    return res.status(201).json({ report });
  })
);

app.post(
  "/api/posts/:id/pin",
  writeRateLimit,
  authMiddleware,
  asyncHandler(async (req, res) => {
    const postId = readTrimmedString(req.params.id, "id");
    const body = requirePlainObject(req.body);
    const pinned = validatePinnedFlag(body.pinned);
    const store = await readStore();

    const post = store.posts.find((candidate) => candidate.id === postId);
    if (!post) {
      throw new HttpError(404, "Post not found");
    }

    const subforum = store.subforums.find((candidate) => candidate.id === post.subforumId);
    if (!subforum) {
      throw new HttpError(404, "Subforum not found");
    }

    if (!isSubforumModerator(subforum, req.userId)) {
      throw new HttpError(403, "Only subforum moderators can pin posts");
    }

    post.isPinned = pinned;
    post.pinnedAt = pinned ? new Date().toISOString() : "";
    post.updatedAt = new Date().toISOString();
    await writeStore(store);

    return res.json({
      post: mapPostForClient(post, store.users, store.subforums, req.userId)
    });
  })
);

app.post(
  "/api/posts/:postId/comments/:commentId/vote",
  writeRateLimit,
  authMiddleware,
  asyncHandler(async (req, res) => {
    const postId = readTrimmedString(req.params.postId, "postId");
    const commentId = readTrimmedString(req.params.commentId, "commentId");
    const body = requirePlainObject(req.body);
    const direction = validateVoteDirection(body.direction);

    const store = await readStore();
    const post = store.posts.find((candidate) => candidate.id === postId);
    if (!post) {
      throw new HttpError(404, "Post not found");
    }

    if (!Array.isArray(post.commentItems)) {
      post.commentItems = [];
    }

    const comment = findCommentById(post.commentItems, commentId);
    if (!comment) {
      throw new HttpError(404, "Comment not found");
    }

    applyCommentVote(comment, req.userId, direction);
    post.updatedAt = new Date().toISOString();

    if (comment.authorId) {
      recalculateUserReputationFromCommentUpvotes(store, comment.authorId);
    }

    const voter = store.users.find((candidate) => candidate.id === req.userId);
    const commentAuthor = store.users.find((candidate) => candidate.id === comment.authorId);
    if (voter) {
      voter.lastActiveAt = new Date().toISOString();
    }

    await writeStore(store);

    return res.json({
      comment: mapCommentForClient(comment, store.users, req.userId),
      author: commentAuthor ? userPublicFields(commentAuthor) : null,
      user: voter ? userPublicFields(voter, { includePrivate: true }) : null
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
    recalculateStoreDerivedFields(store);
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
