import { useEffect, useMemo, useState } from "react";
import { seedThreads } from "./data/seedThreads";

const API_BASE = "http://localhost:4000/api";
const THEME_STORAGE_KEY = "clubdelaia_forum_theme";
const FALLBACK_SUBFORUM_ID = "clubdelaia-general";
const FALLBACK_SUBFORUM_NAME = "ClubDeLaIA";
const FALLBACK_SUBFORUM_SLUG = "clubdelaia";

const sortOptions = [
  { id: "trending", label: "Tendencia" },
  { id: "newest", label: "Nuevos" },
  { id: "top", label: "Mejores" }
];

const categoryOptions = [
  { id: "all", label: "Todo" },
  { id: "discussion", label: "Debate" },
  { id: "resource", label: "Recursos" },
  { id: "help", label: "Ayuda" }
];

const categoryClass = {
  discussion: "tag discussion",
  resource: "tag resource",
  help: "tag help"
};

const categoryLabel = {
  discussion: "Debate",
  resource: "Recursos",
  help: "Ayuda"
};

const commentSortOptions = [
  { id: "popular", label: "Popular" },
  { id: "newest", label: "Nuevo" },
  { id: "oldest", label: "Antiguo" }
];

const commentAccentColors = ["#ff4500", "#0079d3", "#46d160", "#ffb000", "#ea0027", "#7193ff", "#ff585b", "#25b79f"];

function normalizePath(path) {
  if (!path || path === "/") {
    return "/";
  }
  return path.endsWith("/") ? path.slice(0, -1) : path;
}

function getCurrentPath() {
  if (typeof window === "undefined") {
    return "/";
  }
  return normalizePath(window.location.pathname || "/");
}

function slugFromPath(path) {
  const match = path.match(/^\/r\/([^/]+)$/);
  return match ? decodeURIComponent(match[1]) : "";
}

function postIdFromPath(path) {
  const match = path.match(/^\/post\/([^/]+)$/);
  return match ? decodeURIComponent(match[1]) : "";
}

function makeClientId(prefix = "c") {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

async function apiFetch(path, options = {}) {
  const response = await fetch(`${API_BASE}${path}`, {
    credentials: "include",
    ...options,
    headers: {
      ...(options.headers ?? {})
    }
  });

  const text = await response.text();
  let payload = null;

  if (text) {
    try {
      payload = JSON.parse(text);
    } catch {
      payload = null;
    }
  }

  return { response, payload };
}

function toHoursAgo(isoDate) {
  const timestamp = new Date(isoDate).getTime();
  if (Number.isNaN(timestamp)) {
    return 1;
  }

  const diff = Date.now() - timestamp;
  const hours = Math.floor(diff / 3600000);
  return Math.max(1, hours);
}

function getFallbackSubforums(postCount = 0) {
  return [
    {
      id: FALLBACK_SUBFORUM_ID,
      name: FALLBACK_SUBFORUM_NAME,
      slug: FALLBACK_SUBFORUM_SLUG,
      description: "Foro general para temas practicos de IA y desarrollo web.",
      postCount
    }
  ];
}

function mapApiSubforumToClient(subforum) {
  return {
    id: subforum.id,
    name: subforum.name,
    slug: subforum.slug,
    description: subforum.description ?? "",
    postCount: Number.isFinite(subforum.postCount) ? Number(subforum.postCount) : 0
  };
}

function mapApiPostToThread(post) {
  return {
    id: post.id,
    category: post.category,
    score: Number.isFinite(post.score) ? Number(post.score) : 1,
    userVote: Number.isFinite(post.userVote) ? Number(post.userVote) : 0,
    isPinned: Boolean(post.isPinned),
    pinnedAt: typeof post.pinnedAt === "string" ? post.pinnedAt : "",
    canPin: Boolean(post.canPin),
    ageHours: toHoursAgo(post.createdAt),
    title: post.title,
    author: post.author,
    authorId: post.authorId ?? "",
    content: post.content,
    comments: post.comments ?? 0,
    subforumId: post.subforumId ?? FALLBACK_SUBFORUM_ID,
    subforumName: post.subforumName ?? FALLBACK_SUBFORUM_NAME,
    subforumSlug: post.subforumSlug ?? FALLBACK_SUBFORUM_SLUG
  };
}

function mapSeedThreadToThread(thread) {
  return {
    ...thread,
    userVote: 0,
    authorId: thread.authorId ?? "",
    isPinned: false,
    pinnedAt: "",
    canPin: false,
    subforumId: thread.subforumId ?? FALLBACK_SUBFORUM_ID,
    subforumName: thread.subforumName ?? FALLBACK_SUBFORUM_NAME,
    subforumSlug: thread.subforumSlug ?? FALLBACK_SUBFORUM_SLUG
  };
}

function sortThreads(items, selectedSort) {
  const pinned = items.filter((thread) => thread.isPinned);
  const regular = items.filter((thread) => !thread.isPinned);
  const sortByPinnedDate = (a, b) => new Date(b.pinnedAt || 0).getTime() - new Date(a.pinnedAt || 0).getTime();

  const sortSlice = (list) => {
    if (selectedSort === "newest") {
      return [...list].sort((a, b) => a.ageHours - b.ageHours);
    }
    if (selectedSort === "top") {
      return [...list].sort((a, b) => b.score - a.score);
    }
    return [...list].sort((a, b) => {
      const trendA = a.score * 0.7 + (24 - a.ageHours) * 0.3;
      const trendB = b.score * 0.7 + (24 - b.ageHours) * 0.3;
      return trendB - trendA;
    });
  };

  const sortedPinned = sortSlice(pinned).sort(sortByPinnedDate);
  const sortedRegular = sortSlice(regular);
  return [...sortedPinned, ...sortedRegular];
}

function normalizeNotification(item) {
  return {
    id: String(item?.id ?? makeClientId("notif")),
    type: typeof item?.type === "string" ? item.type : "activity",
    message: typeof item?.message === "string" ? item.message : "Nueva actividad",
    actorId: typeof item?.actorId === "string" ? item.actorId : "",
    actorUsername: typeof item?.actorUsername === "string" ? item.actorUsername : "desconocido",
    postId: typeof item?.postId === "string" ? item.postId : "",
    commentId: typeof item?.commentId === "string" ? item.commentId : "",
    createdAt: typeof item?.createdAt === "string" ? item.createdAt : new Date().toISOString(),
    readAt: typeof item?.readAt === "string" ? item.readAt : ""
  };
}

function normalizeNotifications(items) {
  return Array.isArray(items) ? items.map((item) => normalizeNotification(item)) : [];
}

function notificationTimeLabel(value) {
  const ts = new Date(value).getTime();
  if (Number.isNaN(ts)) {
    return "ahora";
  }
  const diffMin = Math.max(0, Math.floor((Date.now() - ts) / 60000));
  if (diffMin < 1) {
    return "ahora";
  }
  if (diffMin < 60) {
    return `${diffMin}m`;
  }
  const h = Math.floor(diffMin / 60);
  if (h < 24) {
    return `${h}h`;
  }
  const d = Math.floor(h / 24);
  return `${d}d`;
}

function filterThreads(items, query, category, subforumId) {
  const q = query.trim().toLowerCase();
  return items.filter((thread) => {
    if (category !== "all" && thread.category !== category) {
      return false;
    }
    if (subforumId !== "all" && thread.subforumId !== subforumId) {
      return false;
    }
    if (!q) {
      return true;
    }

    const text = [
      thread.title,
      thread.author,
      thread.content,
      thread.category,
      thread.subforumName,
      thread.subforumSlug
    ]
      .join(" ")
      .toLowerCase();

    return text.includes(q);
  });
}

function timeAgo(hours) {
  if (hours <= 1) {
    return "hace 1 hora";
  }
  if (hours < 24) {
    return `hace ${hours} horas`;
  }
  const days = Math.round(hours / 24);
  return days <= 1 ? "hace 1 dia" : `hace ${days} dias`;
}

function hashColorForAuthor(author) {
  const source = String(author ?? "desconocido");
  let hash = 0;
  for (const char of source) {
    hash = (hash * 31 + char.charCodeAt(0)) & 0xffff;
  }
  return commentAccentColors[Math.abs(hash) % commentAccentColors.length];
}

function commentTimestamp(value) {
  const timestamp = new Date(value).getTime();
  return Number.isNaN(timestamp) ? 0 : timestamp;
}

function commentTimeAgo(value) {
  const timestamp = commentTimestamp(value);
  if (!timestamp) {
    return "ahora";
  }

  const diffMinutes = Math.max(0, Math.floor((Date.now() - timestamp) / 60000));
  if (diffMinutes < 1) {
    return "ahora";
  }
  if (diffMinutes < 60) {
    return `${diffMinutes}m`;
  }

  const hours = Math.floor(diffMinutes / 60);
  if (hours < 24) {
    return `${hours}h`;
  }

  const days = Math.floor(hours / 24);
  return `${days}d`;
}

function normalizeCommentNode(comment) {
  return {
    id: String(comment?.id ?? makeClientId("comment")),
    authorId: typeof comment?.authorId === "string" ? comment.authorId : "",
    author: comment?.author ?? "desconocido",
    authorReputation: Number.isFinite(comment?.authorReputation) ? Number(comment.authorReputation) : 0,
    createdAt: typeof comment?.createdAt === "string" ? comment.createdAt : new Date().toISOString(),
    content: typeof comment?.content === "string" ? comment.content : "",
    score: Number.isFinite(comment?.score) ? Number(comment.score) : 1,
    userVote: Number.isFinite(comment?.userVote) ? Number(comment.userVote) : 0,
    replies: Array.isArray(comment?.replies) ? comment.replies.map((reply) => normalizeCommentNode(reply)) : []
  };
}

function normalizeComments(nodes) {
  return Array.isArray(nodes) ? nodes.map((node) => normalizeCommentNode(node)) : [];
}

function countCommentTree(nodes) {
  return nodes.reduce((total, node) => total + 1 + countCommentTree(node.replies ?? []), 0);
}

function sortCommentTree(nodes, mode) {
  const sorted = [...nodes];

  sorted.sort((a, b) => {
    if (mode === "newest") {
      return commentTimestamp(b.createdAt) - commentTimestamp(a.createdAt);
    }

    if (mode === "oldest") {
      return commentTimestamp(a.createdAt) - commentTimestamp(b.createdAt);
    }

    if (b.score !== a.score) {
      return b.score - a.score;
    }

    return commentTimestamp(b.createdAt) - commentTimestamp(a.createdAt);
  });

  return sorted.map((node) => ({
    ...node,
    replies: sortCommentTree(node.replies ?? [], mode)
  }));
}

function appendReplyToCommentTree(nodes, parentId, replyNode) {
  let inserted = false;

  const comments = nodes.map((node) => {
    if (node.id === parentId) {
      inserted = true;
      return {
        ...node,
        replies: [replyNode, ...(node.replies ?? [])]
      };
    }

    if (!node.replies || node.replies.length === 0) {
      return node;
    }

    const nestedResult = appendReplyToCommentTree(node.replies, parentId, replyNode);
    if (!nestedResult.inserted) {
      return node;
    }

    inserted = true;
    return {
      ...node,
      replies: nestedResult.comments
    };
  });

  return { comments, inserted };
}

function updateCommentInTree(nodes, commentId, transform) {
  let updated = false;

  const comments = nodes.map((node) => {
    if (node.id === commentId) {
      updated = true;
      return transform(node);
    }

    if (!node.replies || node.replies.length === 0) {
      return node;
    }

    const nested = updateCommentInTree(node.replies, commentId, transform);
    if (!nested.updated) {
      return node;
    }

    updated = true;
    return {
      ...node,
      replies: nested.comments
    };
  });

  return { comments, updated };
}

function createLocalComment(author, content) {
  return {
    id: makeClientId("local"),
    authorId: "",
    author,
    authorReputation: 0,
    createdAt: new Date().toISOString(),
    content,
    score: 1,
    userVote: 0,
    replies: []
  };
}

function mergeCommentIntoPostTree(existingComments, parentCommentId, commentNode) {
  if (!parentCommentId) {
    return [...existingComments, commentNode];
  }

  const appended = appendReplyToCommentTree(existingComments, parentCommentId, commentNode);
  if (appended.inserted) {
    return appended.comments;
  }

  return [commentNode, ...existingComments];
}

function CommentNode({
  comment,
  postAuthor,
  collapsedById,
  replyOpenById,
  replyDraftById,
  currentUser,
  onRequireAuth,
  onToggleCollapse,
  onToggleReplyForm,
  onReplyDraftChange,
  onReplySubmit,
  onCommentVote
}) {
  const isCollapsed = Boolean(collapsedById[comment.id]);
  const isReplyOpen = Boolean(replyOpenById[comment.id]);
  const isOp = comment.author === postAuthor;
  const accentColor = hashColorForAuthor(comment.author);
  const voteState = Number.isFinite(comment.userVote) ? Number(comment.userVote) : 0;
  const visibleScore = Number.isFinite(comment.score) ? Number(comment.score) : 1;

  return (
    <div className={`rc-comment ${isCollapsed ? "collapsed" : ""}`}>
      <button
        type="button"
        className="rc-thread-gutter"
        onClick={() => onToggleCollapse(comment.id)}
        aria-label={isCollapsed ? "Expandir comentario" : "Colapsar comentario"}
      >
        <span className="rc-avatar-dot" style={{ background: accentColor }} aria-hidden="true"></span>
      </button>

      <div className="rc-comment-inner">
        <div className="rc-comment-header">
          <span className={`rc-author ${isOp ? "op" : ""}`} style={{ color: isOp ? "#ff4500" : accentColor }}>
            u/{comment.author}
          </span>
          {isOp ? <span className="rc-flair rc-op-flair">OP</span> : null}
          <span className="rc-time">{commentTimeAgo(comment.createdAt)}</span>
          <span className="rc-collapsed-indicator">[+] hilo colapsado</span>
        </div>

        <div className="rc-comment-body">
          {comment.content
            .split(/\n+/)
            .filter((line) => line.trim().length > 0)
            .map((line, index) => (
              <p key={`${comment.id}-${index}`}>{line}</p>
            ))}
        </div>

        <div className="rc-comment-actions">
          <div className="rc-vote-group">
            <button
              type="button"
              className={`rc-vote-btn ${voteState === 1 ? "active-up" : ""}`}
              onClick={() => void onCommentVote(comment.id, "up")}
              aria-label="Voto positivo"
            >
              ▲
            </button>
            <span className="rc-vote-count">{visibleScore}</span>
            <button
              type="button"
              className={`rc-vote-btn down ${voteState === -1 ? "active-down" : ""}`}
              onClick={() => void onCommentVote(comment.id, "down")}
              aria-label="Voto negativo"
            >
              ▼
            </button>
          </div>

          <button
            type="button"
            className="rc-act-btn rc-reply-btn"
            onClick={() => {
              if (!currentUser) {
                onRequireAuth();
                return;
              }
              onToggleReplyForm(comment.id);
            }}
          >
            Responder
          </button>
          <button type="button" className="rc-act-btn">
            Compartir
          </button>
        </div>

        <div className={`rc-reply-form ${isReplyOpen ? "open" : ""}`}>
          <textarea
            value={replyDraftById[comment.id] ?? ""}
            onChange={(event) => onReplyDraftChange(comment.id, event.target.value)}
            placeholder="Escribe una respuesta..."
          ></textarea>
          <div className="rc-reply-form-actions">
            <button type="button" className="rc-btn-cancel" onClick={() => onToggleReplyForm(comment.id, false)}>
              Cancelar
            </button>
            <button
              type="button"
              className="rc-btn-submit"
              onClick={() => {
                if (!currentUser) {
                  onRequireAuth();
                  return;
                }
                void onReplySubmit(comment.id);
              }}
            >
              Responder
            </button>
          </div>
        </div>

        <div className="rc-replies">
          {(comment.replies ?? []).map((reply) => (
            <CommentNode
              key={reply.id}
              comment={reply}
              postAuthor={postAuthor}
              collapsedById={collapsedById}
              replyOpenById={replyOpenById}
              replyDraftById={replyDraftById}
              currentUser={currentUser}
              onRequireAuth={onRequireAuth}
              onToggleCollapse={onToggleCollapse}
              onToggleReplyForm={onToggleReplyForm}
              onReplyDraftChange={onReplyDraftChange}
              onReplySubmit={onReplySubmit}
              onCommentVote={onCommentVote}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

function ThreadCommentsSection({
  thread,
  comments,
  commentsLoading,
  commentNotice,
  commentDraft,
  onCommentDraftChange,
  onCommentSubmit,
  commentSubmitting,
  currentUser,
  onRequireAuth,
  onReplySubmit,
  onCommentVote
}) {
  const [sortMode, setSortMode] = useState("popular");
  const [collapsedById, setCollapsedById] = useState({});
  const [replyOpenById, setReplyOpenById] = useState({});
  const [replyDraftById, setReplyDraftById] = useState({});

  const sortedComments = useMemo(() => sortCommentTree(comments, sortMode), [comments, sortMode]);
  const commentCount = useMemo(() => countCommentTree(comments), [comments]);

  useEffect(() => {
    setSortMode("popular");
    setCollapsedById({});
    setReplyOpenById({});
    setReplyDraftById({});
  }, [thread.id]);

  function onToggleCollapse(commentId) {
    setCollapsedById((current) => ({ ...current, [commentId]: !current[commentId] }));
  }

  function onToggleReplyForm(commentId, forceOpen) {
    setReplyOpenById((current) => {
      const nextValue = typeof forceOpen === "boolean" ? forceOpen : !current[commentId];
      return { ...current, [commentId]: nextValue };
    });
  }

  function onReplyDraftChange(commentId, value) {
    setReplyDraftById((current) => ({ ...current, [commentId]: value }));
  }

  async function submitReply(parentCommentId) {
    const text = (replyDraftById[parentCommentId] ?? "").trim();
    if (!text) {
      return;
    }

    const created = await onReplySubmit(thread.id, parentCommentId, text);
    if (!created) {
      return;
    }

    setReplyDraftById((current) => ({ ...current, [parentCommentId]: "" }));
    onToggleReplyForm(parentCommentId, false);
  }

  return (
    <div className="comments-panel reddit-comments">
      <div className="rc-post-meta">
        <span>u/{thread.author}</span>
        <span className="rc-dot">·</span>
        <span>{timeAgo(thread.ageHours)}</span>
        <span className="rc-dot">·</span>
        <span>r/{thread.subforumSlug}</span>
      </div>

      <div className="rc-sort-bar">
        <span>Ordenar por:</span>
        {commentSortOptions.map((option) => (
          <button
            key={option.id}
            type="button"
            className={sortMode === option.id ? "active" : ""}
            onClick={() => setSortMode(option.id)}
          >
            {option.label}
          </button>
        ))}
      </div>

      <div className="rc-new-comment-area">
        <textarea
          value={commentDraft}
          onChange={(event) => onCommentDraftChange(thread.id, event.target.value)}
          placeholder={currentUser ? "Que piensas?" : "Inicia sesion para comentar"}
          disabled={!currentUser}
        ></textarea>
        <div className="rc-reply-form-actions">
          {currentUser ? (
            <button type="button" className="rc-btn-submit" onClick={() => onCommentSubmit(thread.id)} disabled={commentSubmitting}>
              {commentSubmitting ? "Enviando..." : "Comentar"}
            </button>
          ) : (
            <button type="button" className="rc-btn-submit" onClick={onRequireAuth}>
              Inicia sesion
            </button>
          )}
        </div>
      </div>

      <p className="rc-comment-count">{commentCount} comentarios</p>

      {commentNotice ? <p className="rc-empty">{commentNotice}</p> : null}

      {commentsLoading ? <p className="rc-empty">Cargando comentarios...</p> : null}

      {!commentsLoading && sortedComments.length === 0 ? (
        <p className="rc-empty">No hay comentarios aun. Se el primero en comentar.</p>
      ) : null}

      {!commentsLoading && sortedComments.length > 0 ? (
        <div className="rc-comments-root">
          {sortedComments.map((comment) => (
            <CommentNode
              key={comment.id}
              comment={comment}
              postAuthor={thread.author}
              collapsedById={collapsedById}
              replyOpenById={replyOpenById}
              replyDraftById={replyDraftById}
              currentUser={currentUser}
              onRequireAuth={onRequireAuth}
              onToggleCollapse={onToggleCollapse}
              onToggleReplyForm={onToggleReplyForm}
              onReplyDraftChange={onReplyDraftChange}
              onReplySubmit={submitReply}
              onCommentVote={(commentId, direction) => onCommentVote(thread.id, commentId, direction)}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}

function VoteColumn({ threadId, score, userVote, onVote }) {
  return (
    <div className="votes">
      <button
        className={`vote-btn upvote ${userVote === 1 ? "active" : ""}`}
        type="button"
        aria-label="Voto positivo"
        onClick={() => onVote(threadId, "up")}
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor">
          <path d="M12 19V5M5 12l7-7 7 7"></path>
        </svg>
      </button>
      <span className="score">{score}</span>
      <button
        className={`vote-btn downvote ${userVote === -1 ? "active" : ""}`}
        type="button"
        aria-label="Voto negativo"
        onClick={() => onVote(threadId, "down")}
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor">
          <path d="M12 5v14M19 12l-7 7-7-7"></path>
        </svg>
      </button>
    </div>
  );
}

function ThreadCard({
  thread,
  onVote,
  isLiked,
  onToggleLike,
  onOpenThread,
  onSelectSubforum,
  detailMode = false,
  canDelete = false,
  deleting = false,
  onDelete,
  canReport = false,
  reporting = false,
  onReport,
  canBlockAuthor = false,
  isAuthorBlocked = false,
  blockingAuthor = false,
  onToggleBlockAuthor,
  canPin = false,
  pinning = false,
  onTogglePin
}) {
  return (
    <article className={`thread-card ${detailMode ? "thread-card-detail" : ""}`}>
      <VoteColumn threadId={thread.id} score={thread.score} userVote={thread.userVote ?? 0} onVote={onVote} />
      <div className="thread-main">
        <div className="thread-meta">
          <button
            type="button"
            className="community-link"
            onClick={() => onSelectSubforum(thread.subforumId)}
            aria-label={`Abrir r/${thread.subforumSlug}`}
          >
            r/{thread.subforumSlug}
          </button>
          <span>•</span>
          <span>Publicado por u/{thread.author}</span>
          <span>•</span>
          <span>{timeAgo(thread.ageHours)}</span>
          {thread.isPinned ? <span className="pin-badge">Fijado</span> : null}
          <span className={categoryClass[thread.category]}>{categoryLabel[thread.category]}</span>
        </div>
        <h2 className="thread-title">
          {detailMode ? (
            thread.title
          ) : (
            <button type="button" className="thread-title-btn" onClick={() => onOpenThread(thread.id)}>
              {thread.title}
            </button>
          )}
        </h2>
        <p className="thread-snippet">{thread.content}</p>

        <div className="thread-actions">
          <button type="button" onClick={() => onOpenThread(thread.id)}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor">
              <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path>
            </svg>
            <span>{detailMode ? "Detalle del hilo" : `${thread.comments} Comentarios`}</span>
          </button>

          <button
            type="button"
            className={isLiked ? "liked-btn" : ""}
            aria-label={isLiked ? "Quitar me gusta" : "Me gusta"}
            onClick={() => onToggleLike(thread.id)}
          >
            <svg viewBox="0 0 24 24" fill={isLiked ? "currentColor" : "none"} stroke="currentColor">
              <path d="M12 21s-6.7-4.35-9.2-8.1C.98 10.14 1.55 6.8 4.6 5.45A5.08 5.08 0 0 1 12 8.02a5.08 5.08 0 0 1 7.4-2.57c3.05 1.35 3.62 4.69 1.8 7.45C18.7 16.65 12 21 12 21z"></path>
            </svg>
            <span>{isLiked ? "Te gusta" : "Me gusta"}</span>
          </button>

          {canDelete ? (
            <button type="button" className="danger-btn" onClick={() => onDelete(thread.id)} disabled={deleting}>
              {deleting ? "Eliminando..." : "Eliminar"}
            </button>
          ) : null}

          {canPin ? (
            <button type="button" onClick={() => onTogglePin(thread.id, !thread.isPinned)} disabled={pinning}>
              {pinning ? "Guardando..." : thread.isPinned ? "Desfijar" : "Fijar"}
            </button>
          ) : null}

          {canReport ? (
            <button type="button" onClick={() => onReport(thread.id)} disabled={reporting}>
              {reporting ? "Reportando..." : "Reportar"}
            </button>
          ) : null}

          {canBlockAuthor ? (
            <button type="button" onClick={() => onToggleBlockAuthor(thread.authorId)} disabled={blockingAuthor}>
              {blockingAuthor ? "Actualizando..." : isAuthorBlocked ? "Desbloquear autor" : "Bloquear autor"}
            </button>
          ) : null}
        </div>
      </div>
    </article>
  );
}

function NotificationsModal({
  open,
  onClose,
  notifications,
  loading,
  error,
  onRefresh,
  onMarkRead,
  onMarkAllRead,
  markAllLoading,
  busyById
}) {
  if (!open) {
    return null;
  }

  return (
    <div className="modal-overlay" role="dialog" aria-modal="true" aria-label="Notificaciones">
      <div className="modal notifications-modal">
        <div className="notifications-head">
          <h2>Notificaciones</h2>
          <div className="notifications-head-actions">
            <button type="button" className="btn-secondary" onClick={onRefresh} disabled={loading}>
              Actualizar
            </button>
            <button type="button" className="btn-secondary" onClick={onMarkAllRead} disabled={markAllLoading}>
              {markAllLoading ? "Marcando..." : "Marcar todo leido"}
            </button>
          </div>
        </div>

        {error ? <p className="auth-error">{error}</p> : null}
        {loading ? <p className="rc-empty">Cargando notificaciones...</p> : null}

        {!loading && notifications.length === 0 ? <p className="rc-empty">No tienes notificaciones.</p> : null}

        {!loading && notifications.length > 0 ? (
          <div className="notifications-list">
            {notifications.map((item) => (
              <article key={item.id} className={`notification-item ${item.readAt ? "read" : "unread"}`}>
                <div className="notification-main">
                  <p className="notification-message">{item.message}</p>
                  <p className="notification-meta">
                    <span>u/{item.actorUsername}</span>
                    <span>•</span>
                    <span>{notificationTimeLabel(item.createdAt)}</span>
                  </p>
                </div>
                {!item.readAt ? (
                  <button
                    type="button"
                    className="btn-secondary"
                    onClick={() => onMarkRead(item.id)}
                    disabled={Boolean(busyById[item.id])}
                  >
                    {busyById[item.id] ? "..." : "Leido"}
                  </button>
                ) : null}
              </article>
            ))}
          </div>
        ) : null}

        <div className="modal-actions">
          <button type="button" className="btn-primary" onClick={onClose}>
            Cerrar
          </button>
        </div>
      </div>
    </div>
  );
}

function NewThreadModal({ open, onClose, onCreate, creating, subforums, defaultSubforumId, error }) {
  const [form, setForm] = useState({
    title: "",
    content: "",
    category: "discussion",
    subforumId: defaultSubforumId || ""
  });

  useEffect(() => {
    if (!open) {
      return;
    }

    setForm({
      title: "",
      content: "",
      category: "discussion",
      subforumId: defaultSubforumId || ""
    });
  }, [open, defaultSubforumId]);

  if (!open) {
    return null;
  }

  function onChange(event) {
    const { name, value } = event.target;
    setForm((current) => ({ ...current, [name]: value }));
  }

  async function onSubmit(event) {
    event.preventDefault();
    if (!form.title.trim() || !form.content.trim() || !form.subforumId) {
      return;
    }

    const success = await onCreate({
      title: form.title,
      content: form.content,
      category: form.category,
      subforumId: form.subforumId
    });

    if (success) {
      onClose();
    }
  }

  const disabled = creating || subforums.length === 0;

  return (
    <div className="modal-overlay" role="dialog" aria-modal="true" aria-label="Crear nuevo hilo">
      <form className="modal" onSubmit={onSubmit}>
        <h2>Crear Publicacion</h2>

        <label>
          <span>Titulo</span>
          <input name="title" value={form.title} onChange={onChange} placeholder="Escribe un titulo claro para tu publicacion" />
        </label>

        <label>
          <span>Subforo</span>
          <select name="subforumId" value={form.subforumId} onChange={onChange} disabled={subforums.length === 0}>
            <option value="" disabled>
              {subforums.length === 0 ? "No hay subforos disponibles" : "Selecciona un subforo"}
            </option>
            {subforums.map((subforum) => (
              <option key={subforum.id} value={subforum.id}>
                {subforum.name} (r/{subforum.slug})
              </option>
            ))}
          </select>
        </label>

        <label>
          <span>Categoria</span>
          <select name="category" value={form.category} onChange={onChange}>
            <option value="discussion">Debate</option>
            <option value="resource">Recursos</option>
            <option value="help">Ayuda</option>
          </select>
        </label>

        <label>
          <span>Contenido</span>
          <textarea
            name="content"
            value={form.content}
            onChange={onChange}
            rows={4}
            placeholder="Agrega el texto, enlaces o detalles de tu pregunta"
          ></textarea>
        </label>

        {error ? <p className="auth-error">{error}</p> : null}

        <div className="modal-actions">
          <button type="button" className="btn-secondary" onClick={onClose} disabled={creating}>
            Cancelar
          </button>
          <button type="submit" className="btn-primary" disabled={disabled}>
            {creating ? "Publicando..." : "Publicar"}
          </button>
        </div>
      </form>
    </div>
  );
}

function AuthModal({ open, mode, onClose, onSwitchMode, onSubmit, loading, error }) {
  const [form, setForm] = useState({
    username: "",
    password: ""
  });

  if (!open) {
    return null;
  }

  function onChange(event) {
    const { name, value } = event.target;
    setForm((current) => ({ ...current, [name]: value }));
  }

  async function submit(event) {
    event.preventDefault();
    await onSubmit({
      mode,
      username: form.username,
      password: form.password
    });
  }

  return (
    <div className="modal-overlay" role="dialog" aria-modal="true" aria-label="Autenticacion">
      <form className="modal" onSubmit={submit}>
        <h2>{mode === "register" ? "Crear cuenta" : "Iniciar sesion"}</h2>

        <label>
          <span>Usuario</span>
          <input
            name="username"
            value={form.username}
            onChange={onChange}
            placeholder="tu_usuario"
            required
          />
        </label>

        <label>
          <span>Contrasena</span>
          <input
            name="password"
            type="password"
            value={form.password}
            onChange={onChange}
            placeholder={mode === "register" ? "Minimo 8 caracteres, letra y numero" : "Tu contrasena"}
            required
          />
        </label>

        {error ? <p className="auth-error">{error}</p> : null}

        <div className="modal-actions">
          <button type="button" className="btn-secondary" onClick={onClose} disabled={loading}>
            Cancelar
          </button>
          <button type="submit" className="btn-primary" disabled={loading}>
            {loading ? "Espera..." : mode === "register" ? "Crear cuenta" : "Iniciar sesion"}
          </button>
        </div>

        <button type="button" className="auth-switch" onClick={onSwitchMode}>
          {mode === "register" ? "Ya tienes cuenta? Inicia sesion" : "Necesitas cuenta? Registrate"}
        </button>
      </form>
    </div>
  );
}

function NewSubforumModal({ open, onClose, onCreate, creating, error }) {
  const [form, setForm] = useState({
    name: "",
    description: ""
  });

  useEffect(() => {
    if (!open) {
      return;
    }
    setForm({ name: "", description: "" });
  }, [open]);

  if (!open) {
    return null;
  }

  function onChange(event) {
    const { name, value } = event.target;
    setForm((current) => ({ ...current, [name]: value }));
  }

  async function onSubmit(event) {
    event.preventDefault();
    if (!form.name.trim()) {
      return;
    }

    const success = await onCreate({
      name: form.name,
      description: form.description
    });

    if (success) {
      onClose();
    }
  }

  return (
    <div className="modal-overlay" role="dialog" aria-modal="true" aria-label="Crear nuevo subforo">
      <form className="modal" onSubmit={onSubmit}>
        <h2>Crear Subforo</h2>

        <label>
          <span>Nombre</span>
          <input name="name" value={form.name} onChange={onChange} placeholder="Frontend, DevOps, UX Writing..." />
        </label>

        <label>
          <span>Descripcion</span>
          <textarea
            name="description"
            value={form.description}
            onChange={onChange}
            rows={3}
            placeholder="Que temas pertenecen a este subforo?"
          ></textarea>
        </label>

        {error ? <p className="auth-error">{error}</p> : null}

        <div className="modal-actions">
          <button type="button" className="btn-secondary" onClick={onClose} disabled={creating}>
            Cancelar
          </button>
          <button type="submit" className="btn-primary" disabled={creating}>
            {creating ? "Creando..." : "Crear Subforo"}
          </button>
        </div>
      </form>
    </div>
  );
}

export default function App() {
  const [forumTheme, setForumTheme] = useState(() => {
    try {
      const saved = localStorage.getItem(THEME_STORAGE_KEY);
      return saved === "dark" ? "dark" : "light";
    } catch {
      return "light";
    }
  });

  const [threads, setThreads] = useState([]);
  const [subforums, setSubforums] = useState([]);
  const [selectedSort, setSelectedSort] = useState("trending");
  const [selectedCategory, setSelectedCategory] = useState("all");
  const [selectedSubforumId, setSelectedSubforumId] = useState("all");
  const [query, setQuery] = useState("");

  const [activeTab, setActiveTab] = useState("home");
  const [routePath, setRoutePath] = useState(() => getCurrentPath());
  const [likedPostIds, setLikedPostIds] = useState([]);
  const [leaderboardUsers, setLeaderboardUsers] = useState([]);
  const [leaderboardLoading, setLeaderboardLoading] = useState(false);
  const [leaderboardError, setLeaderboardError] = useState("");
  const [notifications, setNotifications] = useState([]);
  const [unreadNotifications, setUnreadNotifications] = useState(0);
  const [notificationsLoading, setNotificationsLoading] = useState(false);
  const [notificationsError, setNotificationsError] = useState("");
  const [isNotificationsOpen, setIsNotificationsOpen] = useState(false);
  const [notificationBusyById, setNotificationBusyById] = useState({});
  const [markingAllNotifications, setMarkingAllNotifications] = useState(false);

  const [commentsByPost, setCommentsByPost] = useState({});
  const [activePostId, setActivePostId] = useState(null);
  const [commentDraftByPost, setCommentDraftByPost] = useState({});
  const [commentsLoadingByPost, setCommentsLoadingByPost] = useState({});
  const [commentSubmittingByPost, setCommentSubmittingByPost] = useState({});
  const [commentNoticeByPost, setCommentNoticeByPost] = useState({});

  const [isPostModalOpen, setIsPostModalOpen] = useState(false);
  const [isSubforumModalOpen, setIsSubforumModalOpen] = useState(false);
  const [isAuthModalOpen, setIsAuthModalOpen] = useState(false);
  const [authMode, setAuthMode] = useState("login");
  const [authError, setAuthError] = useState("");
  const [authLoading, setAuthLoading] = useState(false);
  const [creatingPost, setCreatingPost] = useState(false);
  const [createPostError, setCreatePostError] = useState("");
  const [creatingSubforum, setCreatingSubforum] = useState(false);
  const [subforumError, setSubforumError] = useState("");
  const [deletePostError, setDeletePostError] = useState("");
  const [moderationNotice, setModerationNotice] = useState("");
  const [moderationBusyByPost, setModerationBusyByPost] = useState({});
  const [blockBusyByUser, setBlockBusyByUser] = useState({});
  const [deletingPostId, setDeletingPostId] = useState("");
  const [loadingPosts, setLoadingPosts] = useState(true);

  const [currentUser, setCurrentUser] = useState(null);

  const selectedSubforum = useMemo(() => {
    return subforums.find((subforum) => subforum.id === selectedSubforumId) ?? null;
  }, [subforums, selectedSubforumId]);

  const defaultSubforumId = useMemo(() => {
    if (selectedSubforumId !== "all" && subforums.some((subforum) => subforum.id === selectedSubforumId)) {
      return selectedSubforumId;
    }
    return subforums[0]?.id ?? "";
  }, [selectedSubforumId, subforums]);

  const postCountBySubforum = useMemo(() => {
    return threads.reduce((counts, thread) => {
      counts[thread.subforumId] = (counts[thread.subforumId] ?? 0) + 1;
      return counts;
    }, {});
  }, [threads]);

  const visibleThreads = useMemo(() => {
    const source = activeTab === "liked" ? threads.filter((thread) => likedPostIds.includes(thread.id)) : threads;
    const filtered = filterThreads(source, query, selectedCategory, selectedSubforumId);
    return sortThreads(filtered, selectedSort);
  }, [activeTab, threads, likedPostIds, query, selectedCategory, selectedSubforumId, selectedSort]);

  const activeThread = useMemo(() => {
    if (!activePostId) {
      return null;
    }
    return threads.find((thread) => thread.id === activePostId) ?? null;
  }, [threads, activePostId]);

  async function loadFeedData(options = {}) {
    const showLoading = options.showLoading !== false;

    if (showLoading) {
      setLoadingPosts(true);
    }

    try {
      const [{ response: postsResponse, payload: postsPayload }, { response: subforumsResponse, payload: subforumsPayload }] =
        await Promise.all([apiFetch("/posts"), apiFetch("/subforums")]);

      if (!postsResponse.ok) {
        throw new Error(postsPayload?.error || "No se pudieron cargar las publicaciones");
      }
      if (!subforumsResponse.ok) {
        throw new Error(subforumsPayload?.error || "No se pudieron cargar los subforos");
      }

      const mappedPosts = Array.isArray(postsPayload?.posts) ? postsPayload.posts.map(mapApiPostToThread) : [];
      const mappedSubforums = Array.isArray(subforumsPayload?.subforums)
        ? subforumsPayload.subforums.map(mapApiSubforumToClient)
        : [];

      setThreads(mappedPosts);
      setSubforums(
        mappedSubforums.length > 0
          ? mappedSubforums.sort((a, b) => a.slug.localeCompare(b.slug))
          : getFallbackSubforums(mappedPosts.length)
      );
    } catch {
      const fallbackThreads = seedThreads.map(mapSeedThreadToThread);
      setThreads(fallbackThreads);
      setSubforums(getFallbackSubforums(fallbackThreads.length));
    } finally {
      if (showLoading) {
        setLoadingPosts(false);
      }
    }
  }

  async function loadNotifications(options = {}) {
    if (!currentUser) {
      setNotifications([]);
      setUnreadNotifications(0);
      return;
    }

    const silent = Boolean(options.silent);
    if (!silent) {
      setNotificationsLoading(true);
      setNotificationsError("");
    }

    try {
      const { response, payload } = await apiFetch("/notifications");
      if (!response.ok) {
        if (response.status === 401) {
          setCurrentUser(null);
          return;
        }
        throw new Error(payload?.error || "No se pudieron cargar las notificaciones");
      }

      const items = normalizeNotifications(payload?.notifications);
      setNotifications(items);
      setUnreadNotifications(Number.isFinite(payload?.unreadCount) ? Number(payload.unreadCount) : 0);
    } catch (error) {
      if (!silent) {
        setNotificationsError(error instanceof Error ? error.message : "No se pudieron cargar las notificaciones");
      }
    } finally {
      if (!silent) {
        setNotificationsLoading(false);
      }
    }
  }

  useEffect(() => {
    try {
      localStorage.setItem(THEME_STORAGE_KEY, forumTheme);
    } catch {
      // Ignore storage errors and keep in-memory preference.
    }

    document.body.classList.toggle("theme-dark", forumTheme === "dark");

    return () => {
      document.body.classList.remove("theme-dark");
    };
  }, [forumTheme]);

  useEffect(() => {
    void loadFeedData({ showLoading: true });
  }, []);

  useEffect(() => {
    async function loadSession() {
      try {
        const { response, payload } = await apiFetch("/auth/me");
        if (!response.ok) {
          setCurrentUser(null);
          return;
        }

        setCurrentUser(payload?.user ?? null);
      } catch {
        setCurrentUser(null);
      }
    }

    loadSession();
  }, []);

  useEffect(() => {
    if (!currentUser) {
      setNotifications([]);
      setUnreadNotifications(0);
      return;
    }

    void loadNotifications();

    const intervalId = window.setInterval(() => {
      void loadNotifications({ silent: true });
    }, 30000);

    return () => window.clearInterval(intervalId);
  }, [currentUser?.id]);

  useEffect(() => {
    function onPopState() {
      setRoutePath(getCurrentPath());
    }

    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  useEffect(() => {
    if (selectedSubforumId === "all") {
      return;
    }

    if (!subforums.some((subforum) => subforum.id === selectedSubforumId)) {
      setSelectedSubforumId("all");
    }
  }, [selectedSubforumId, subforums]);

  useEffect(() => {
    if (currentUser && Array.isArray(currentUser.favoritePostIds)) {
      setLikedPostIds(currentUser.favoritePostIds);
      return;
    }
    setLikedPostIds([]);
  }, [currentUser]);

  useEffect(() => {
    void loadFeedData({ showLoading: false });
  }, [currentUser?.id]);

  useEffect(() => {
    const path = normalizePath(routePath);

    if (path === "/liked") {
      setActiveTab("liked");
      setActivePostId(null);
      return;
    }

    if (path === "/leaderboard") {
      setActiveTab("leaderboard");
      setActivePostId(null);
      return;
    }

    const postId = postIdFromPath(path);
    if (postId) {
      setActiveTab("home");
      setActivePostId(postId);
      const thread = threads.find((candidate) => candidate.id === postId);
      if (thread) {
        setSelectedSubforumId(thread.subforumId);
      }
      if (!Object.prototype.hasOwnProperty.call(commentsByPost, postId)) {
        void loadComments(postId);
      }
      return;
    }

    const subforumSlug = slugFromPath(path);
    if (subforumSlug) {
      const found = subforums.find((subforum) => subforum.slug === subforumSlug);
      setActiveTab("home");
      setActivePostId(null);
      setSelectedSubforumId(found ? found.id : "all");
      return;
    }

    setActiveTab("home");
    setActivePostId(null);
    setSelectedSubforumId("all");
  }, [routePath, subforums, threads, commentsByPost]);

  useEffect(() => {
    if (activeTab !== "leaderboard") {
      return;
    }

    if (leaderboardUsers.length > 0 || leaderboardLoading) {
      return;
    }

    void loadLeaderboard();
  }, [activeTab, leaderboardUsers.length, leaderboardLoading]);

  function openAuthModal(mode, errorMessage = "") {
    setAuthMode(mode);
    setAuthError(errorMessage);
    setIsAuthModalOpen(true);
  }

  function requireAuth(message) {
    openAuthModal("login", message);
  }

  function pathForSubforumId(subforumId) {
    if (subforumId === "all") {
      return "/";
    }
    const subforum = subforums.find((candidate) => candidate.id === subforumId);
    if (!subforum) {
      return "/";
    }
    return `/r/${encodeURIComponent(subforum.slug)}`;
  }

  function navigateToPath(path, options = {}) {
    const next = normalizePath(path);
    const replace = Boolean(options.replace);

    if (next !== getCurrentPath()) {
      if (replace) {
        window.history.replaceState({}, "", next);
      } else {
        window.history.pushState({}, "", next);
      }
    }

    setRoutePath(next);
  }

  function mergeThreadUpdate(updatedThread) {
    setThreads((current) => current.map((thread) => (thread.id === updatedThread.id ? updatedThread : thread)));
  }

  async function loadLeaderboard() {
    setLeaderboardLoading(true);
    setLeaderboardError("");

    try {
      const { response, payload } = await apiFetch("/users/leaderboard");
      if (!response.ok) {
        throw new Error(payload?.error || "No se pudo cargar el leaderboard");
      }
      const users = Array.isArray(payload?.users) ? payload.users : [];
      setLeaderboardUsers(users);
    } catch (error) {
      setLeaderboardError(error instanceof Error ? error.message : "No se pudo cargar el leaderboard");
    } finally {
      setLeaderboardLoading(false);
    }
  }

  async function onMarkNotificationRead(notificationId) {
    if (!currentUser) {
      return;
    }

    setNotificationBusyById((current) => ({ ...current, [notificationId]: true }));

    try {
      const { response, payload } = await apiFetch(`/notifications/${notificationId}/read`, {
        method: "POST"
      });

      if (!response.ok) {
        throw new Error(payload?.error || "No se pudo marcar la notificacion");
      }

      const now = new Date().toISOString();
      setNotifications((current) =>
        current.map((item) => (item.id === notificationId ? { ...item, readAt: item.readAt || now } : item))
      );
      setUnreadNotifications((current) => Math.max(0, current - 1));
    } catch (error) {
      setNotificationsError(error instanceof Error ? error.message : "No se pudo marcar la notificacion");
    } finally {
      setNotificationBusyById((current) => ({ ...current, [notificationId]: false }));
    }
  }

  async function onMarkAllNotificationsRead() {
    if (!currentUser) {
      return;
    }

    setMarkingAllNotifications(true);
    setNotificationsError("");

    try {
      const { response, payload } = await apiFetch("/notifications/read-all", {
        method: "POST"
      });
      if (!response.ok) {
        throw new Error(payload?.error || "No se pudieron marcar las notificaciones");
      }

      const now = new Date().toISOString();
      setNotifications((current) => current.map((item) => (item.readAt ? item : { ...item, readAt: now })));
      setUnreadNotifications(0);
    } catch (error) {
      setNotificationsError(error instanceof Error ? error.message : "No se pudieron marcar las notificaciones");
    } finally {
      setMarkingAllNotifications(false);
    }
  }

  async function onReportThread(postId) {
    if (!currentUser) {
      requireAuth("Inicia sesion para reportar publicaciones.");
      return;
    }

    const rawReason = window.prompt("Motivo del reporte (opcional):", "");
    if (rawReason == null) {
      return;
    }

    setModerationBusyByPost((current) => ({ ...current, [postId]: true }));
    setModerationNotice("");

    try {
      const { response, payload } = await apiFetch(`/posts/${postId}/report`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ reason: rawReason })
      });

      if (!response.ok) {
        if (response.status === 401) {
          setCurrentUser(null);
          requireAuth("La sesion expiro. Inicia sesion de nuevo.");
          return;
        }
        throw new Error(payload?.error || "No se pudo reportar la publicacion");
      }

      setModerationNotice("Reporte enviado correctamente.");
    } catch (error) {
      setModerationNotice(error instanceof Error ? error.message : "No se pudo reportar la publicacion");
    } finally {
      setModerationBusyByPost((current) => ({ ...current, [postId]: false }));
    }
  }

  async function onTogglePinThread(postId, nextPinned) {
    if (!currentUser) {
      requireAuth("Inicia sesion para fijar publicaciones.");
      return;
    }

    setModerationBusyByPost((current) => ({ ...current, [postId]: true }));
    setModerationNotice("");

    try {
      const { response, payload } = await apiFetch(`/posts/${postId}/pin`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ pinned: nextPinned })
      });

      if (!response.ok) {
        if (response.status === 401) {
          setCurrentUser(null);
          requireAuth("La sesion expiro. Inicia sesion de nuevo.");
          return;
        }
        throw new Error(payload?.error || "No se pudo actualizar el estado fijado");
      }

      if (payload?.post) {
        mergeThreadUpdate(mapApiPostToThread(payload.post));
      }
      setModerationNotice(nextPinned ? "Publicacion fijada." : "Publicacion desfijada.");
    } catch (error) {
      setModerationNotice(error instanceof Error ? error.message : "No se pudo actualizar el estado fijado");
    } finally {
      setModerationBusyByPost((current) => ({ ...current, [postId]: false }));
    }
  }

  async function onToggleBlockAuthor(authorId) {
    if (!currentUser) {
      requireAuth("Inicia sesion para bloquear usuarios.");
      return;
    }

    if (!authorId || authorId === currentUser.id) {
      return;
    }

    setBlockBusyByUser((current) => ({ ...current, [authorId]: true }));
    setModerationNotice("");

    try {
      const { response, payload } = await apiFetch(`/users/${authorId}/block`, {
        method: "POST"
      });

      if (!response.ok) {
        if (response.status === 401) {
          setCurrentUser(null);
          requireAuth("La sesion expiro. Inicia sesion de nuevo.");
          return;
        }
        throw new Error(payload?.error || "No se pudo actualizar el bloqueo");
      }

      if (payload?.user) {
        setCurrentUser(payload.user);
      }

      await loadFeedData({ showLoading: false });
      if (activePostId) {
        void loadComments(activePostId);
      }
      if (payload?.blocked && activeThread?.authorId === authorId) {
        navigateToPath(pathForSubforumId(selectedSubforumId));
      }
      setModerationNotice(payload?.blocked ? "Usuario bloqueado." : "Usuario desbloqueado.");
    } catch (error) {
      setModerationNotice(error instanceof Error ? error.message : "No se pudo actualizar el bloqueo");
    } finally {
      setBlockBusyByUser((current) => ({ ...current, [authorId]: false }));
    }
  }

  async function onVote(threadId, direction) {
    if (!currentUser) {
      requireAuth("Inicia sesion para votar publicaciones.");
      return;
    }

    setDeletePostError("");

    try {
      const { response, payload } = await apiFetch(`/posts/${threadId}/vote`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ direction })
      });

      if (!response.ok) {
        if (response.status === 401) {
          setCurrentUser(null);
          requireAuth("La sesion expiro. Inicia sesion de nuevo.");
          return;
        }
        throw new Error(payload?.error || "No se pudo votar la publicacion");
      }

      if (payload?.post) {
        mergeThreadUpdate(mapApiPostToThread(payload.post));
      }
      if (payload?.user) {
        setCurrentUser(payload.user);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "No se pudo votar la publicacion";
      setDeletePostError(message);
    }
  }

  async function onToggleLike(threadId) {
    if (!currentUser) {
      requireAuth("Inicia sesion para guardar favoritos.");
      return;
    }

    setDeletePostError("");

    try {
      const { response, payload } = await apiFetch(`/posts/${threadId}/favorite`, {
        method: "POST"
      });

      if (!response.ok) {
        if (response.status === 401) {
          setCurrentUser(null);
          requireAuth("La sesion expiro. Inicia sesion de nuevo.");
          return;
        }
        throw new Error(payload?.error || "No se pudo actualizar favoritos");
      }

      const favoritePostIds = Array.isArray(payload?.favoritePostIds) ? payload.favoritePostIds : [];
      setLikedPostIds(favoritePostIds);
      if (payload?.user) {
        setCurrentUser(payload.user);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "No se pudo actualizar favoritos";
      setDeletePostError(message);
    }
  }

  function onSelectSubforum(subforumId) {
    navigateToPath(pathForSubforumId(subforumId));
  }

  async function loadComments(postId) {
    setCommentsLoadingByPost((current) => ({ ...current, [postId]: true }));
    try {
      const { response, payload } = await apiFetch(`/posts/${postId}/comments`);

      if (!response.ok) {
        throw new Error(payload?.error || "No se pudieron cargar los comentarios");
      }

      setCommentsByPost((current) => ({ ...current, [postId]: normalizeComments(payload?.comments) }));
    } catch {
      setCommentsByPost((current) => ({ ...current, [postId]: current[postId] ?? [] }));
    } finally {
      setCommentsLoadingByPost((current) => ({ ...current, [postId]: false }));
    }
  }

  function openPostDetail(postId) {
    navigateToPath(`/post/${encodeURIComponent(postId)}`);
  }

  function closePostDetail() {
    navigateToPath(pathForSubforumId(selectedSubforumId));
  }

  function onCommentDraftChange(postId, value) {
    setCommentDraftByPost((current) => ({ ...current, [postId]: value }));
  }

  function increaseThreadCommentCount(postId, fallbackDelta = 1, serverCount) {
    setThreads((current) =>
      current.map((thread) => {
        if (thread.id !== postId) {
          return thread;
        }

        const fallbackCount = thread.comments + fallbackDelta;
        const safeServerCount = Number.isFinite(serverCount) ? Number(serverCount) : fallbackCount;
        return { ...thread, comments: Math.max(safeServerCount, fallbackCount) };
      })
    );
  }

  async function onCommentSubmit(postId) {
    const draft = (commentDraftByPost[postId] ?? "").trim();
    if (!draft) {
      return;
    }

    if (!currentUser) {
      requireAuth("Inicia sesion para comentar.");
      return;
    }

    const created = await submitCommentOrReply(postId, draft, {
      parentCommentId: "",
      fallbackNotice: "Comentario guardado localmente. El servidor no pudo guardarlo por ahora.",
      fallbackErrorPrefix: "Comentario guardado localmente. Error del servidor:",
      requestErrorMessage: "No se pudo crear el comentario"
    });

    if (created) {
      setCommentDraftByPost((current) => ({ ...current, [postId]: "" }));
    }
  }

  async function onReplySubmit(postId, parentCommentId, content) {
    const draft = content.trim();
    if (!draft) {
      return false;
    }

    if (!currentUser) {
      requireAuth("Inicia sesion para comentar.");
      return false;
    }

    return submitCommentOrReply(postId, draft, {
      parentCommentId,
      fallbackNotice: "Respuesta guardada localmente. El servidor no pudo guardarla por ahora.",
      fallbackErrorPrefix: "Respuesta guardada localmente. Error del servidor:",
      requestErrorMessage: "No se pudo crear la respuesta"
    });
  }

  async function submitCommentOrReply(
    postId,
    content,
    { parentCommentId, fallbackNotice, fallbackErrorPrefix, requestErrorMessage }
  ) {
    const isReply = Boolean(parentCommentId);
    const requestBody = isReply ? { content, parentCommentId } : { content };

    setCommentNoticeByPost((current) => ({ ...current, [postId]: "" }));
    setCommentSubmittingByPost((current) => ({ ...current, [postId]: true }));

    try {
      const { response, payload } = await apiFetch(`/posts/${postId}/comments`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify(requestBody)
      });

      if (!response.ok) {
        if (response.status === 401) {
          setCurrentUser(null);
          requireAuth("La sesion expiro. Inicia sesion de nuevo.");
          return false;
        }

        if (response.status === 404 || response.status >= 500) {
          const localComment = createLocalComment(currentUser.username, content);
          setCommentsByPost((current) => {
            const existing = current[postId] ?? [];
            return {
              ...current,
              [postId]: mergeCommentIntoPostTree(existing, parentCommentId, localComment)
            };
          });
          increaseThreadCommentCount(postId, 1);
          setCommentNoticeByPost((current) => ({ ...current, [postId]: fallbackNotice }));
          return true;
        }

        throw new Error(payload?.error || requestErrorMessage);
      }

      const createdComment = normalizeCommentNode(payload?.comment);
      setCommentsByPost((current) => {
        const existing = current[postId] ?? [];
        return {
          ...current,
          [postId]: mergeCommentIntoPostTree(existing, parentCommentId, createdComment)
        };
      });

      increaseThreadCommentCount(postId, 1, payload?.comments);
      setCommentNoticeByPost((current) => ({ ...current, [postId]: "" }));

      if (payload?.user) {
        setCurrentUser(payload.user);
      }

      return true;
    } catch (error) {
      const localComment = createLocalComment(currentUser.username, content);
      setCommentsByPost((current) => {
        const existing = current[postId] ?? [];
        return {
          ...current,
          [postId]: mergeCommentIntoPostTree(existing, parentCommentId, localComment)
        };
      });
      increaseThreadCommentCount(postId, 1);

      const message = error instanceof Error ? error.message : requestErrorMessage;
      setCommentNoticeByPost((current) => ({
        ...current,
        [postId]: `${fallbackErrorPrefix} ${message}`
      }));
      return true;
    } finally {
      setCommentSubmittingByPost((current) => ({ ...current, [postId]: false }));
    }
  }

  async function onCommentVote(postId, commentId, direction) {
    if (!currentUser) {
      requireAuth("Inicia sesion para votar comentarios.");
      return;
    }

    try {
      const { response, payload } = await apiFetch(`/posts/${postId}/comments/${commentId}/vote`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ direction })
      });

      if (!response.ok) {
        if (response.status === 401) {
          setCurrentUser(null);
          requireAuth("La sesion expiro. Inicia sesion de nuevo.");
          return;
        }
        throw new Error(payload?.error || "No se pudo votar el comentario");
      }

      const updatedComment = normalizeCommentNode(payload?.comment);
      setCommentsByPost((current) => {
        const existing = current[postId] ?? [];
        const updated = updateCommentInTree(existing, commentId, () => updatedComment);
        if (!updated.updated) {
          return current;
        }
        return {
          ...current,
          [postId]: updated.comments
        };
      });

      if (payload?.user) {
        setCurrentUser(payload.user);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "No se pudo votar el comentario";
      setCommentNoticeByPost((current) => ({
        ...current,
        [postId]: message
      }));
    }
  }

  async function onDeleteThread(postId) {
    if (!currentUser) {
      requireAuth("Inicia sesion para borrar publicaciones.");
      return;
    }

    const confirmed = window.confirm("Quieres eliminar esta publicacion?");
    if (!confirmed) {
      return;
    }

    setDeletingPostId(postId);
    setDeletePostError("");
    setModerationNotice("");

    try {
      const { response, payload } = await apiFetch(`/posts/${postId}`, {
        method: "DELETE"
      });

      if (!response.ok) {
        if (response.status === 401) {
          setCurrentUser(null);
          requireAuth("La sesion expiro. Inicia sesion de nuevo.");
          return;
        }
        throw new Error(payload?.error || "No se pudo eliminar la publicacion");
      }

      setThreads((current) => current.filter((thread) => thread.id !== postId));
      setCommentsByPost((current) => {
        const next = { ...current };
        delete next[postId];
        return next;
      });
      setLikedPostIds((current) => current.filter((id) => id !== postId));

      if (activePostId === postId) {
        navigateToPath(pathForSubforumId(selectedSubforumId));
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "No se pudo eliminar la publicacion";
      setDeletePostError(message);
    } finally {
      setDeletingPostId("");
    }
  }

  function openCreatePost() {
    if (!currentUser) {
      requireAuth("Inicia sesion para crear publicaciones.");
      return;
    }

    if (subforums.length === 0) {
      return;
    }

    setCreatePostError("");
    setDeletePostError("");
    setModerationNotice("");
    setIsPostModalOpen(true);
  }

  function openCreateSubforum() {
    if (!currentUser) {
      requireAuth("Inicia sesion para crear subforos.");
      return;
    }

    setSubforumError("");
    setDeletePostError("");
    setModerationNotice("");
    setIsSubforumModalOpen(true);
  }

  async function onCreateThread(postInput) {
    if (!currentUser) {
      requireAuth("Inicia sesion para crear publicaciones.");
      return false;
    }

    setCreatingPost(true);
    setCreatePostError("");

    try {
      const { response, payload } = await apiFetch("/posts", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify(postInput)
      });

      if (!response.ok) {
        if (response.status === 401) {
          setCurrentUser(null);
          requireAuth("La sesion expiro. Inicia sesion de nuevo.");
          return false;
        }
        throw new Error(payload?.error || "No se pudo crear la publicacion");
      }

      const mappedPost = mapApiPostToThread(payload?.post);
      setThreads((current) => [mappedPost, ...current]);
      if (payload?.user) {
        setCurrentUser(payload.user);
      }

      setSelectedSort("newest");
      setSelectedCategory("all");
      setSelectedSubforumId(mappedPost.subforumId);
      setQuery("");
      navigateToPath(pathForSubforumId(mappedPost.subforumId));
      return true;
    } catch (error) {
      const message = error instanceof Error ? error.message : "No se pudo crear la publicacion";
      setCreatePostError(message);
      return false;
    } finally {
      setCreatingPost(false);
    }
  }

  async function onCreateSubforum(input) {
    if (!currentUser) {
      requireAuth("Inicia sesion para crear subforos.");
      return false;
    }

    setCreatingSubforum(true);
    setSubforumError("");

    try {
      const { response, payload } = await apiFetch("/subforums", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify(input)
      });

      if (!response.ok) {
        if (response.status === 401) {
          setCurrentUser(null);
          requireAuth("La sesion expiro. Inicia sesion de nuevo.");
          return false;
        }
        throw new Error(payload?.error || "No se pudo crear el subforo");
      }

      const mappedSubforum = mapApiSubforumToClient(payload?.subforum);
      setSubforums((current) =>
        [...current, mappedSubforum].sort((a, b) => a.slug.localeCompare(b.slug))
      );
      navigateToPath(pathForSubforumId(mappedSubforum.id));
      return true;
    } catch (error) {
      const message = error instanceof Error ? error.message : "No se pudo crear el subforo";
      setSubforumError(message);
      return false;
    } finally {
      setCreatingSubforum(false);
    }
  }

  async function onAuthSubmit(values) {
    setAuthError("");
    setAuthLoading(true);

    try {
      const endpoint = values.mode === "register" ? "/auth/register" : "/auth/login";
      const body = {
        username: values.username,
        password: values.password
      };

      const { response, payload } = await apiFetch(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify(body)
      });

      if (!response.ok) {
        throw new Error(payload?.error || "La autenticacion fallo");
      }

      setCurrentUser(payload?.user ?? null);
      setIsAuthModalOpen(false);
      setAuthError("");
    } catch (error) {
      setAuthError(error instanceof Error ? error.message : "La autenticacion fallo");
    } finally {
      setAuthLoading(false);
    }
  }

  async function logout() {
    try {
      await apiFetch("/auth/logout", {
        method: "POST"
      });
    } catch {
      // The client state is still cleared locally.
    }

    setCurrentUser(null);
    setLikedPostIds([]);
    setNotifications([]);
    setUnreadNotifications(0);
    navigateToPath("/");
  }

  const feedTitle =
    activeTab === "liked"
      ? "Tus publicaciones con me gusta"
      : activeTab === "leaderboard"
        ? "Leaderboard"
      : selectedSubforum
        ? `r/${selectedSubforum.slug}`
        : "Todos los subforos";

  const feedDescription =
    activeTab === "liked"
      ? "Publicaciones marcadas con me gusta."
      : activeTab === "leaderboard"
        ? "Ranking de usuarios por reputacion."
      : selectedSubforum
        ? selectedSubforum.description || `Hilos de ${selectedSubforum.name}.`
        : "Posts generales relacionados con IA.";

  const activePostCommentDraft = activeThread ? commentDraftByPost[activeThread.id] ?? "" : "";
  const activePostComments = activeThread ? commentsByPost[activeThread.id] ?? [] : [];
  const activePostCommentsLoading = activeThread ? Boolean(commentsLoadingByPost[activeThread.id]) : false;
  const activePostCommentSubmitting = activeThread ? Boolean(commentSubmittingByPost[activeThread.id]) : false;
  const activePostCommentNotice = activeThread ? commentNoticeByPost[activeThread.id] ?? "" : "";

  return (
    <div className="app">
      <header className="header">
        <div className="header-inner">
          <a
            href="/"
            className="brand"
            onClick={(event) => {
              event.preventDefault();
              navigateToPath("/");
            }}
          >
            <span className="brand-icon" aria-hidden="true"></span>
            <span>ClubDeLaIA</span>
          </a>

          <nav className="header-links">
            <button
              type="button"
              className={`header-link-btn ${activeTab === "home" ? "active" : ""}`}
              onClick={() => navigateToPath(pathForSubforumId(selectedSubforumId))}
            >
              Inicio
            </button>
            <button
              type="button"
              className={`header-link-btn ${activeTab === "liked" ? "active" : ""}`}
              onClick={() => navigateToPath("/liked")}
            >
              <span className="heart"></span>
              Me gusta
            </button>
            <button
              type="button"
              className={`header-link-btn ${activeTab === "leaderboard" ? "active" : ""}`}
              onClick={() => navigateToPath("/leaderboard")}
            >
              Leaderboard
            </button>
          </nav>

          <div className="header-actions">
            <button
              type="button"
              className="btn-secondary theme-toggle-btn"
              onClick={() => setForumTheme((current) => (current === "dark" ? "light" : "dark"))}
              aria-label={forumTheme === "dark" ? "Cambiar a tema blanco" : "Cambiar a tema negro"}
            >
              {forumTheme === "dark" ? "Claro" : "Oscuro"}
            </button>
            {currentUser ? (
              <>
                <span className="username-chip">u/{currentUser.username}</span>
                <span className="username-chip">Rep: {currentUser.reputation}</span>
                <button type="button" className="btn-secondary notif-btn" onClick={() => setIsNotificationsOpen(true)}>
                  Notificaciones
                  {unreadNotifications > 0 ? <span className="notif-badge">{unreadNotifications}</span> : null}
                </button>
                <button type="button" className="btn-secondary" onClick={logout}>
                  Cerrar sesion
                </button>
              </>
            ) : (
              <button type="button" className="btn-secondary" onClick={() => openAuthModal("login", "")}>
                Iniciar sesion
              </button>
            )}
            <button type="button" className="btn-primary" onClick={openCreatePost}>
              Crear Publicacion
            </button>
          </div>
        </div>
      </header>

      <div className="layout">
        <aside className="left-sidebar">
          <section className="panel">
            <h2>Subforos</h2>
            <div className="subforum-list">
              <button
                type="button"
                className={`subforum-btn ${selectedSubforumId === "all" ? "active" : ""}`}
                onClick={() => navigateToPath("/")}
              >
                <span>Todos los subforos</span>
                <span>{threads.length}</span>
              </button>

              {subforums.map((subforum) => (
                <button
                  key={subforum.id}
                  type="button"
                  className={`subforum-btn ${selectedSubforumId === subforum.id ? "active" : ""}`}
                  onClick={() => onSelectSubforum(subforum.id)}
                >
                  <span>r/{subforum.slug}</span>
                  <span>{postCountBySubforum[subforum.id] ?? subforum.postCount ?? 0}</span>
                </button>
              ))}
            </div>

            <button className="btn-secondary full-width-btn" type="button" onClick={openCreateSubforum}>
              Crear Subforo
            </button>
          </section>

          <section className="panel profile-card">
            <h2>Tu perfil</h2>
            {currentUser ? (
              <>
                <p className="profile-username">u/{currentUser.username}</p>
                <div className="stats">
                  <div>
                    <strong>{currentUser.reputation}</strong>
                    <span>Reputacion</span>
                  </div>
                  <div>
                    <strong>{likedPostIds.length}</strong>
                    <span>Me gusta</span>
                  </div>
                </div>
                <button type="button" className="btn-secondary full-width-btn" onClick={logout}>
                  Cerrar sesion
                </button>
              </>
            ) : (
              <>
                <p>Inicia sesion para ver tu perfil y participar en los subforos.</p>
                <button type="button" className="btn-primary full-width-btn" onClick={() => openAuthModal("login", "")}>
                  Iniciar sesion
                </button>
              </>
            )}
          </section>
        </aside>

        <main className="main-column">
          {activeThread ? (
            <>
              <section className="post-view-head">
                <button type="button" className="back-btn" onClick={closePostDetail}>
                  Volver al feed
                </button>
                <p>Viendo hilo en detalle</p>
              </section>

              {deletePostError ? <div className="empty-state danger-state">{deletePostError}</div> : null}
              {moderationNotice ? <div className="empty-state">{moderationNotice}</div> : null}

              <section className="thread-list thread-list-detail">
                <ThreadCard
                  thread={activeThread}
                  onVote={onVote}
                  isLiked={likedPostIds.includes(activeThread.id)}
                  onToggleLike={onToggleLike}
                  onOpenThread={openPostDetail}
                  onSelectSubforum={onSelectSubforum}
                  canDelete={Boolean(currentUser && activeThread.authorId === currentUser.id)}
                  deleting={deletingPostId === activeThread.id}
                  onDelete={onDeleteThread}
                  canReport={Boolean(currentUser && activeThread.authorId !== currentUser.id)}
                  reporting={Boolean(moderationBusyByPost[activeThread.id])}
                  onReport={onReportThread}
                  canBlockAuthor={Boolean(currentUser && activeThread.authorId && activeThread.authorId !== currentUser.id)}
                  isAuthorBlocked={Boolean(currentUser?.blockedUserIds?.includes(activeThread.authorId))}
                  blockingAuthor={Boolean(blockBusyByUser[activeThread.authorId])}
                  onToggleBlockAuthor={onToggleBlockAuthor}
                  canPin={Boolean(currentUser && activeThread.canPin)}
                  pinning={Boolean(moderationBusyByPost[activeThread.id])}
                  onTogglePin={onTogglePinThread}
                  detailMode
                />

                <ThreadCommentsSection
                  thread={activeThread}
                  comments={activePostComments}
                  commentsLoading={activePostCommentsLoading}
                  commentNotice={activePostCommentNotice}
                  commentDraft={activePostCommentDraft}
                  onCommentDraftChange={onCommentDraftChange}
                  onCommentSubmit={onCommentSubmit}
                  commentSubmitting={activePostCommentSubmitting}
                  currentUser={currentUser}
                  onRequireAuth={() => requireAuth("Inicia sesion para comentar.")}
                  onReplySubmit={onReplySubmit}
                  onCommentVote={onCommentVote}
                />
              </section>
            </>
          ) : (
            <>
              <section className="feed-head">
                <h1>{feedTitle}</h1>
                <p>{feedDescription}</p>
              </section>

              {deletePostError ? <div className="empty-state danger-state">{deletePostError}</div> : null}
              {moderationNotice ? <div className="empty-state">{moderationNotice}</div> : null}

              {activeTab !== "leaderboard" ? (
                <section className="toolbar" aria-label="Controles del feed">
                {sortOptions.map((option) => (
                  <button
                    key={option.id}
                    type="button"
                    className={`filter-btn ${selectedSort === option.id ? "active" : ""}`}
                    onClick={() => setSelectedSort(option.id)}
                  >
                    {option.label}
                  </button>
                ))}

                <div className="category-group">
                  {categoryOptions.map((option) => (
                    <button
                      key={option.id}
                      type="button"
                      className={`category-btn ${selectedCategory === option.id ? "active" : ""}`}
                      onClick={() => setSelectedCategory(option.id)}
                    >
                      {option.label}
                    </button>
                  ))}
                </div>

                <label className="subforum-filter">
                  <span>Subforo</span>
                  <select
                    value={selectedSubforumId}
                    onChange={(event) => {
                      navigateToPath(pathForSubforumId(event.target.value));
                    }}
                  >
                    <option value="all">Todo</option>
                    {subforums.map((subforum) => (
                      <option key={subforum.id} value={subforum.id}>
                        r/{subforum.slug}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="search-wrap" aria-label="Buscar hilos">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor">
                    <circle cx="11" cy="11" r="7"></circle>
                    <path d="m20 20-3.4-3.4"></path>
                  </svg>
                  <input
                    className="search-input"
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                    type="search"
                    placeholder="Buscar por titulo, autor o contenido"
                  />
                </label>
                </section>
              ) : null}

              {activeTab === "leaderboard" ? (
                <section className="thread-list">
                  {leaderboardLoading ? <div className="empty-state">Cargando leaderboard...</div> : null}
                  {!leaderboardLoading && leaderboardError ? <div className="empty-state danger-state">{leaderboardError}</div> : null}
                  {!leaderboardLoading && !leaderboardError && leaderboardUsers.length === 0 ? (
                    <div className="empty-state">Aun no hay usuarios para mostrar.</div>
                  ) : null}
                  {!leaderboardLoading && !leaderboardError && leaderboardUsers.length > 0 ? (
                    <div className="leaderboard-list">
                      {leaderboardUsers.map((user, index) => (
                        <article key={user.id} className="leaderboard-row">
                          <span className="leaderboard-rank">#{index + 1}</span>
                          <div className="leaderboard-main">
                            <strong>u/{user.username}</strong>
                            <span>Actividad: {user.activityScore}</span>
                          </div>
                          <span className="leaderboard-rep">{user.reputation} rep</span>
                        </article>
                      ))}
                    </div>
                  ) : null}
                </section>
              ) : (
                <section className="thread-list">
                  {loadingPosts ? <div className="empty-state">Cargando publicaciones...</div> : null}

                  {!loadingPosts && visibleThreads.length > 0
                    ? visibleThreads.map((thread) => (
                        <ThreadCard
                          key={thread.id}
                          thread={thread}
                          onVote={onVote}
                          isLiked={likedPostIds.includes(thread.id)}
                          onToggleLike={onToggleLike}
                          onOpenThread={openPostDetail}
                          onSelectSubforum={onSelectSubforum}
                          canDelete={Boolean(currentUser && thread.authorId === currentUser.id)}
                          deleting={deletingPostId === thread.id}
                          onDelete={onDeleteThread}
                          canReport={Boolean(currentUser && thread.authorId !== currentUser.id)}
                          reporting={Boolean(moderationBusyByPost[thread.id])}
                          onReport={onReportThread}
                          canBlockAuthor={Boolean(currentUser && thread.authorId && thread.authorId !== currentUser.id)}
                          isAuthorBlocked={Boolean(currentUser?.blockedUserIds?.includes(thread.authorId))}
                          blockingAuthor={Boolean(blockBusyByUser[thread.authorId])}
                          onToggleBlockAuthor={onToggleBlockAuthor}
                          canPin={Boolean(currentUser && thread.canPin)}
                          pinning={Boolean(moderationBusyByPost[thread.id])}
                          onTogglePin={onTogglePinThread}
                        />
                      ))
                    : null}

                  {!loadingPosts && visibleThreads.length === 0 ? (
                    <div className="empty-state">
                      {activeTab === "liked"
                        ? "Aun no tienes publicaciones con me gusta. Presiona el corazon en alguna publicacion."
                        : "No hay hilos que coincidan con este filtro y busqueda."}
                    </div>
                  ) : null}
                </section>
              )}
            </>
          )}
        </main>

        <aside className="sidebar">
          <section className="panel">
            <h2>Sobre la comunidad</h2>
            <p>Un espacio para preguntar, compartir recursos y debatir temas practicos de codigo e IA.</p>

            <div className="stats">
              <div>
                <strong>{threads.length}</strong>
                <span>Publicaciones</span>
              </div>
              <div>
                <strong>{subforums.length}</strong>
                <span>Subforos</span>
              </div>
            </div>

            <button className="btn-primary" type="button" onClick={openCreatePost}>
              Crear Publicacion
            </button>
          </section>

          <section className="panel">
            <h2>Etiquetas</h2>
            <div className="pill-group">
              <span className="pill">debate</span>
              <span className="pill">ayuda</span>
              <span className="pill">recursos</span>
            </div>
          </section>

          <section className="panel">
            <h2>Reglas de la casa</h2>
            <ol className="rules">
              <li>
                <strong>Se amable.</strong> Explica por que tu respuesta funciona.
              </li>
              <li>
                <strong>Agrega contexto.</strong> Comparte codigo y comportamiento esperado.
              </li>
              <li>
                <strong>Manten el foco.</strong> Publica contenido relevante para la comunidad.
              </li>
            </ol>
          </section>
        </aside>
      </div>

      <NewThreadModal
        open={isPostModalOpen}
        onClose={() => {
          setIsPostModalOpen(false);
          setCreatePostError("");
        }}
        onCreate={onCreateThread}
        creating={creatingPost}
        subforums={subforums}
        defaultSubforumId={defaultSubforumId}
        error={createPostError}
      />

      <NewSubforumModal
        open={isSubforumModalOpen}
        onClose={() => {
          setIsSubforumModalOpen(false);
          setSubforumError("");
        }}
        onCreate={onCreateSubforum}
        creating={creatingSubforum}
        error={subforumError}
      />

      <AuthModal
        open={isAuthModalOpen}
        mode={authMode}
        onClose={() => {
          setIsAuthModalOpen(false);
          setAuthError("");
        }}
        onSwitchMode={() => {
          setAuthError("");
          setAuthMode((current) => (current === "login" ? "register" : "login"));
        }}
        onSubmit={onAuthSubmit}
        loading={authLoading}
        error={authError}
      />

      <NotificationsModal
        open={isNotificationsOpen}
        onClose={() => setIsNotificationsOpen(false)}
        notifications={notifications}
        loading={notificationsLoading}
        error={notificationsError}
        onRefresh={() => void loadNotifications()}
        onMarkRead={onMarkNotificationRead}
        onMarkAllRead={onMarkAllNotificationsRead}
        markAllLoading={markingAllNotifications}
        busyById={notificationBusyById}
      />
    </div>
  );
}
