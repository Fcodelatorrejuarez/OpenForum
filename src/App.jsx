import { useEffect, useMemo, useState } from "react";
import { seedThreads } from "./data/seedThreads";

const API_BASE = "http://localhost:4000/api";
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
    score: post.score,
    ageHours: toHoursAgo(post.createdAt),
    title: post.title,
    author: post.author,
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
    subforumId: thread.subforumId ?? FALLBACK_SUBFORUM_ID,
    subforumName: thread.subforumName ?? FALLBACK_SUBFORUM_NAME,
    subforumSlug: thread.subforumSlug ?? FALLBACK_SUBFORUM_SLUG
  };
}

function sortThreads(items, selectedSort) {
  const list = [...items];
  if (selectedSort === "newest") {
    return list.sort((a, b) => a.ageHours - b.ageHours);
  }
  if (selectedSort === "top") {
    return list.sort((a, b) => b.score - a.score);
  }
  return list.sort((a, b) => {
    const trendA = a.score * 0.7 + (24 - a.ageHours) * 0.3;
    const trendB = b.score * 0.7 + (24 - b.ageHours) * 0.3;
    return trendB - trendA;
  });
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

function VoteColumn({ threadId, baseScore, voteState, onVote }) {
  const score = baseScore + voteState;

  return (
    <div className="votes">
      <button
        className={`vote-btn upvote ${voteState === 1 ? "active" : ""}`}
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
        className={`vote-btn downvote ${voteState === -1 ? "active" : ""}`}
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
  voteState,
  onVote,
  isLiked,
  onToggleLike,
  onOpenThread,
  onSelectSubforum,
  detailMode = false
}) {
  return (
    <article className={`thread-card ${detailMode ? "thread-card-detail" : ""}`}>
      <VoteColumn threadId={thread.id} baseScore={thread.score} voteState={voteState} onVote={onVote} />
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
        </div>
      </div>
    </article>
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
      const saved = localStorage.getItem("clubdelaia_forum_theme");
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
  const [votesByThread, setVotesByThread] = useState({});

  const [activeTab, setActiveTab] = useState("home");
  const [likedPostIds, setLikedPostIds] = useState(() => {
    try {
      const raw = localStorage.getItem("clubdelaia_liked_posts");
      if (!raw) {
        return [];
      }
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  });

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
    return threads.reduce((current, thread) => {
      const previous = current[thread.subforumId] ?? 0;
      return { ...current, [thread.subforumId]: previous + 1 };
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

  useEffect(() => {
    localStorage.setItem("clubdelaia_liked_posts", JSON.stringify(likedPostIds));
  }, [likedPostIds]);

  useEffect(() => {
    try {
      localStorage.setItem("clubdelaia_forum_theme", forumTheme);
    } catch {
      // Ignore storage errors and keep in-memory preference.
    }

    document.body.classList.toggle("theme-dark", forumTheme === "dark");

    return () => {
      document.body.classList.remove("theme-dark");
    };
  }, [forumTheme]);

  useEffect(() => {
    async function loadInitialData() {
      setLoadingPosts(true);
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
        setLoadingPosts(false);
      }
    }

    loadInitialData();
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
    if (selectedSubforumId === "all") {
      return;
    }

    if (!subforums.some((subforum) => subforum.id === selectedSubforumId)) {
      setSelectedSubforumId("all");
    }
  }, [selectedSubforumId, subforums]);

  function openAuthModal(mode, errorMessage = "") {
    setAuthMode(mode);
    setAuthError(errorMessage);
    setIsAuthModalOpen(true);
  }

  function requireAuth(message) {
    openAuthModal("login", message);
  }

  function onVote(threadId, direction) {
    setVotesByThread((current) => {
      const previous = current[threadId] ?? 0;
      const next = direction === "up" ? (previous === 1 ? 0 : 1) : previous === -1 ? 0 : -1;
      return { ...current, [threadId]: next };
    });
  }

  function onToggleLike(threadId) {
    setLikedPostIds((current) => {
      if (current.includes(threadId)) {
        return current.filter((id) => id !== threadId);
      }
      return [...current, threadId];
    });
  }

  function onSelectSubforum(subforumId) {
    setSelectedSubforumId(subforumId);
    setActiveTab("home");
    setActivePostId(null);
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
    setActivePostId(postId);
    if (!Object.prototype.hasOwnProperty.call(commentsByPost, postId)) {
      void loadComments(postId);
    }
  }

  function closePostDetail() {
    setActivePostId(null);
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

    setCommentNoticeByPost((current) => ({ ...current, [postId]: "" }));

    setCommentSubmittingByPost((current) => ({ ...current, [postId]: true }));

    try {
      const { response, payload } = await apiFetch(`/posts/${postId}/comments`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ content: draft })
      });

      if (!response.ok) {
        if (response.status === 401) {
          setCurrentUser(null);
          requireAuth("La sesion expiro. Inicia sesion de nuevo.");
          return;
        }

        // If server cannot persist (fallback data or temporary backend issue), keep UX functional locally.
        if (response.status === 404 || response.status >= 500) {
          const localComment = createLocalComment(currentUser.username, draft);
          setCommentsByPost((current) => ({
            ...current,
            [postId]: [...(current[postId] ?? []), localComment]
          }));
          increaseThreadCommentCount(postId, 1);
          setCommentDraftByPost((current) => ({ ...current, [postId]: "" }));
          setCommentNoticeByPost((current) => ({
            ...current,
            [postId]: "Comentario guardado localmente. El servidor no pudo guardarlo por ahora."
          }));
          return;
        }

        throw new Error(payload?.error || "No se pudo crear el comentario");
      }

      setCommentsByPost((current) => ({
        ...current,
        [postId]: [...(current[postId] ?? []), normalizeCommentNode(payload?.comment)]
      }));

      increaseThreadCommentCount(postId, 1, payload?.comments);

      setCommentDraftByPost((current) => ({ ...current, [postId]: "" }));
      setCommentNoticeByPost((current) => ({ ...current, [postId]: "" }));

      if (payload?.user) {
        setCurrentUser(payload.user);
      }
    } catch (error) {
      const localComment = createLocalComment(currentUser.username, draft);
      setCommentsByPost((current) => ({
        ...current,
        [postId]: [...(current[postId] ?? []), localComment]
      }));
      increaseThreadCommentCount(postId, 1);
      setCommentDraftByPost((current) => ({ ...current, [postId]: "" }));

      const message = error instanceof Error ? error.message : "No se pudo crear el comentario";
      setCommentNoticeByPost((current) => ({
        ...current,
        [postId]: `Comentario guardado localmente. Error del servidor: ${message}`
      }));
    } finally {
      setCommentSubmittingByPost((current) => ({ ...current, [postId]: false }));
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

    setCommentNoticeByPost((current) => ({ ...current, [postId]: "" }));

    setCommentSubmittingByPost((current) => ({ ...current, [postId]: true }));

    try {
      const { response, payload } = await apiFetch(`/posts/${postId}/comments`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ content: draft, parentCommentId })
      });

      if (!response.ok) {
        if (response.status === 401) {
          setCurrentUser(null);
          requireAuth("La sesion expiro. Inicia sesion de nuevo.");
          return false;
        }

        if (response.status === 404 || response.status >= 500) {
          const localReply = createLocalComment(currentUser.username, draft);
          setCommentsByPost((current) => {
            const existing = current[postId] ?? [];
            const appended = appendReplyToCommentTree(existing, parentCommentId, localReply);
            if (!appended.inserted) {
              return {
                ...current,
                [postId]: [localReply, ...existing]
              };
            }

            return {
              ...current,
              [postId]: appended.comments
            };
          });
          increaseThreadCommentCount(postId, 1);
          setCommentNoticeByPost((current) => ({
            ...current,
            [postId]: "Respuesta guardada localmente. El servidor no pudo guardarla por ahora."
          }));
          return true;
        }

        throw new Error(payload?.error || "No se pudo crear la respuesta");
      }

      const replyNode = normalizeCommentNode(payload?.comment);
      setCommentsByPost((current) => {
        const existing = current[postId] ?? [];
        const appended = appendReplyToCommentTree(existing, parentCommentId, replyNode);
        if (!appended.inserted) {
          return {
            ...current,
            [postId]: [replyNode, ...existing]
          };
        }

        return {
          ...current,
          [postId]: appended.comments
        };
      });

      increaseThreadCommentCount(postId, 1, payload?.comments);
      setCommentNoticeByPost((current) => ({ ...current, [postId]: "" }));

      if (payload?.user) {
        setCurrentUser(payload.user);
      }

      return true;
    } catch (error) {
      const localReply = createLocalComment(currentUser.username, draft);
      setCommentsByPost((current) => {
        const existing = current[postId] ?? [];
        const appended = appendReplyToCommentTree(existing, parentCommentId, localReply);
        if (!appended.inserted) {
          return {
            ...current,
            [postId]: [localReply, ...existing]
          };
        }

        return {
          ...current,
          [postId]: appended.comments
        };
      });
      increaseThreadCommentCount(postId, 1);

      const message = error instanceof Error ? error.message : "No se pudo crear la respuesta";
      setCommentNoticeByPost((current) => ({
        ...current,
        [postId]: `Respuesta guardada localmente. Error del servidor: ${message}`
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

  function openCreatePost() {
    if (!currentUser) {
      requireAuth("Inicia sesion para crear publicaciones.");
      return;
    }

    if (subforums.length === 0) {
      return;
    }

    setCreatePostError("");
    setIsPostModalOpen(true);
  }

  function openCreateSubforum() {
    if (!currentUser) {
      requireAuth("Inicia sesion para crear subforos.");
      return;
    }

    setSubforumError("");
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
      setActiveTab("home");
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
      setSelectedSubforumId(mappedSubforum.id);
      setActiveTab("home");
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
  }

  const feedTitle =
    activeTab === "liked"
      ? "Tus publicaciones con me gusta"
      : selectedSubforum
        ? `r/${selectedSubforum.slug}`
        : "Todos los subforos";

  const feedDescription =
    activeTab === "liked"
      ? "Publicaciones que marcaste con corazon."
      : selectedSubforum
        ? selectedSubforum.description || `Hilos de ${selectedSubforum.name}.`
        : "Hilos simples y practicos sobre IA y desarrollo frontend.";

  const activePostCommentDraft = activeThread ? commentDraftByPost[activeThread.id] ?? "" : "";
  const activePostComments = activeThread ? commentsByPost[activeThread.id] ?? [] : [];
  const activePostCommentsLoading = activeThread ? Boolean(commentsLoadingByPost[activeThread.id]) : false;
  const activePostCommentSubmitting = activeThread ? Boolean(commentSubmittingByPost[activeThread.id]) : false;
  const activePostCommentNotice = activeThread ? commentNoticeByPost[activeThread.id] ?? "" : "";

  return (
    <div className="app">
      <header className="header">
        <div className="header-inner">
          <a href="#" className="brand">
            <span className="brand-icon" aria-hidden="true"></span>
            <span>ClubDeLaIA</span>
          </a>

          <nav className="header-links">
            <button
              type="button"
              className={`header-link-btn ${activeTab === "home" ? "active" : ""}`}
              onClick={() => {
                setActiveTab("home");
                setActivePostId(null);
              }}
            >
              Inicio
            </button>
            <button
              type="button"
              className={`header-link-btn ${activeTab === "liked" ? "active" : ""}`}
              onClick={() => {
                setActiveTab("liked");
                setActivePostId(null);
              }}
            >
              <span className="heart"></span>
              Me gusta
            </button>
          </nav>

          <div className="header-actions">
            <button
              type="button"
              className="btn-secondary theme-toggle-btn"
              onClick={() => setForumTheme((current) => (current === "dark" ? "light" : "dark"))}
              aria-label={forumTheme === "dark" ? "Cambiar a tema blanco" : "Cambiar a tema negro"}
            >
              {forumTheme === "dark" ? "Foro blanco" : "Foro negro"}
            </button>
            {currentUser ? (
              <>
                <span className="username-chip">u/{currentUser.username}</span>
                <span className="username-chip">Rep: {currentUser.reputation}</span>
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
                onClick={() => {
                  setSelectedSubforumId("all");
                  setActiveTab("home");
                }}
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

              <section className="thread-list thread-list-detail">
                <ThreadCard
                  thread={activeThread}
                  voteState={votesByThread[activeThread.id] ?? 0}
                  onVote={onVote}
                  isLiked={likedPostIds.includes(activeThread.id)}
                  onToggleLike={onToggleLike}
                  onOpenThread={openPostDetail}
                  onSelectSubforum={onSelectSubforum}
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
                      setSelectedSubforumId(event.target.value);
                      setActiveTab("home");
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

              <section className="thread-list">
                {loadingPosts ? <div className="empty-state">Cargando publicaciones...</div> : null}

                {!loadingPosts && visibleThreads.length > 0
                  ? visibleThreads.map((thread) => (
                      <ThreadCard
                        key={thread.id}
                        thread={thread}
                        voteState={votesByThread[thread.id] ?? 0}
                        onVote={onVote}
                        isLiked={likedPostIds.includes(thread.id)}
                        onToggleLike={onToggleLike}
                        onOpenThread={openPostDetail}
                        onSelectSubforum={onSelectSubforum}
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
              <span className="pill">pregunta</span>
              <span className="pill">tipografia</span>
              <span className="pill">a11y</span>
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
    </div>
  );
}
