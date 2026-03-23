# ClubDeLaIA

ClubDeLaIA is a full-stack forum app with:

- React + Vite frontend
- Node.js + Express backend
- JWT-based authentication with HttpOnly cookie sessions
- Subforums (reddit-like niches) with creation and browsing
- Post system (list/create/delete own post)
- Persistent post voting (upvote/downvote with toggle)
- Persistent favorites ("Me gusta") linked to user account
- Notifications for replies and @mentions
- Basic moderation tools (report, pin post, block user)
- Reputation system based on user activity
- Backend validation and basic rate limiting for auth/write actions
- Leaderboard view and shareable frontend routes

## Project Structure

- src: React frontend
- backend/server.js: API server
- backend/data/store.json: Simple JSON data store for users, subforums and posts

## Requirements

- Node.js 18+
- npm

## Setup

1. Install dependencies:

	 npm install

2. Run frontend + backend together:

	 npm run dev

3. Open the frontend:

	 http://localhost:5173

4. Backend runs on:

	 http://localhost:4000

## Backend Environment

Optional environment variables:

- PORT (default: 4000)
- FRONTEND_ORIGIN (default: http://localhost:5173)
- JWT_SECRET
  - required in production
	- in development, if omitted, the server creates and reuses `backend/data/dev-jwt-secret.txt`
	- this keeps sessions valid across nodemon restarts
  - must be at least 32 characters long if provided

On PowerShell, example:

$env:JWT_SECRET="replace-with-a-strong-secret"
npm run dev:server

## API Endpoints

Base URL: http://localhost:4000/api

Authentication:

- POST /auth/register
	- body: { username, password }
	- sets an HttpOnly session cookie
	- returns: { user }

- POST /auth/login
	- body: { username, password }
	- sets an HttpOnly session cookie
	- returns: { user }

- POST /auth/logout
	- clears the session cookie

- GET /auth/me
	- uses the session cookie
	- returns: { user }

- GET /users/leaderboard
	- public
	- returns: users sorted by reputation

- POST /users/:id/block
	- protected
	- toggles block/unblock for target user
	- returns: { blocked, blockedUserIds, user }

Subforums:

- GET /subforums
	- public
	- returns: list of subforums and post counts

- POST /subforums
	- protected
	- uses the session cookie
	- body: { name, description? }
	- returns: { subforum }

Posts:

- GET /posts
	- public
	- returns: { posts }

- POST /posts
	- protected
	- uses the session cookie
	- body: { title, content, category, subforumId }
	- category: discussion | resource | help
	- returns: { post, user }

- POST /posts/:id/vote
	- protected
	- uses the session cookie
	- body: { direction }
	- direction: up | down
	- returns: { post, user }

- POST /posts/:id/favorite
	- protected
	- uses the session cookie
	- toggles favorite status for current user
	- returns: { favorited, favoritePostIds, user }

- POST /posts/:id/report
	- protected
	- uses the session cookie
	- body: { reason? }
	- creates moderation report for the post
	- returns: { report }

- POST /posts/:id/pin
	- protected
	- uses the session cookie
	- body: { pinned }
	- only subforum creator can pin/unpin
	- returns: { post }

- GET /posts/:id/comments
	- public
	- returns: comments for a post

- POST /posts/:id/comments
	- protected
	- uses the session cookie
	- body: { content }
	- returns: { comment, comments, user }

- DELETE /posts/:id
	- protected
	- only post author can delete

Health check:

- GET /health

Notifications:

- GET /notifications
	- protected
	- returns: { notifications, unreadCount }

- POST /notifications/:id/read
	- protected
	- marks one notification as read

- POST /notifications/read-all
	- protected
	- marks all user notifications as read

## Frontend Notes

- If backend is available, the app loads posts from the API.
- If backend is unavailable, the app falls back to local seed threads for read-only browsing.
- Creating posts requires authentication.
- Auth state is restored from the HttpOnly session cookie instead of localStorage.
- Header shows current logged user reputation.
- Notifications dropdown/modal is available for logged users.
- Posts from blocked users are hidden from your feed and comment view.
- Pinned posts are shown first in the feed.
- Shareable routes are supported:
	- `/`
	- `/r/:slug`
	- `/post/:id`
	- `/liked`
	- `/leaderboard`

## Security Notes

- Auth sessions are stored in an HttpOnly cookie with `SameSite=Lax`.
- Auth endpoints are rate limited.
- Write actions (create post, create comment, create subforum, delete post) are rate limited.
- Backend payloads are validated for type, length and allowed values before write operations.

## Reputation Rules

- New user starts with 10 reputation.
- Reputation is recalculated from upvotes received on:
	- the user's comments
	- the user's posts (excluding self-upvotes)
- First login of each day grants +1 activity score.
- Creating a post grants +3 activity score.
- Creating a comment grants +2 activity score.

## Future Improvements

- Refresh tokens and CSRF protection for stricter session hardening
- Persistent database (PostgreSQL / MongoDB)
- Moderator dashboard for handling reports
- Input validation library (zod or joi)
