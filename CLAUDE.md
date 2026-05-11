# Habit Tracker - Project Guidelines

## Context
A self-hosted personal habit called deltis and activity tracking PWA. Designed for NAS deployment via Docker.
Later the Frontend will be supplemented with an android app as well as an ios app.

## Language Policy
- **Development:** All technical content (code, variable names, function names, comments, documentation, and commit messages) MUST be in **English**.
- **User Interface (UI):** All user-facing strings (labels, buttons, toast messages, tooltips) MUST be in **German**.
- **Communication:** Chat interactions should remain direct, technical, and concise.

## Tech Stack
- **Frontend:** React (Vite), TailwindCSS, PWA.
- **Backend:** Node.js, Express.
- **Database:** MongoDB.
- **Auth:** Bcrypt + Pepper, users will only be created by an admin.

## Coding Standards
- **UI/UX:** Mobile-first design (PWA). Use Tailwind for all styling.
- **Logic:** Use "Early Returns" to reduce nesting. 
- **API:** RESTful endpoints under `/api`. Ensure all routes are protected.
- **Security:** Never log sensitive data (passwords, peppers, UUIDs).

## Common Commands
- **Install:** `npm run install:all`
- **Dev:** `npm run dev`
- **Build:** `./build-nas.sh`
- **Backup:** `./backup.sh`