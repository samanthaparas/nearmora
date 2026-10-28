# Nearmora — Technical Stack & Professional Development Requirements

I'm developing **Nearmora**, a privacy-first, local-first desktop application for organizing, rediscovering, curating, and creatively sharing personal photo and video memories.

**Tagline:** Keep the feeling close.

Nearmora is intended to become a real consumer product, not just a portfolio exercise. However, I also want to use its development to expand my software engineering skills and strengthen my qualifications for junior/associate frontend and full-stack developer positions.

## 1. My existing technical background

I already have hands-on experience with:

- JavaScript (ES6+)
- React, React Router, Hooks, Vite
- HTML5, CSS3, responsive design, BEM
- Node.js and Express
- REST APIs
- MongoDB and Mongoose
- Authentication with JWT and bcrypt
- Git and GitHub
- CI workflows with automated checks and protected merges
- Deployment using Render
- Postman
- AWS fundamentals, including creating an S3 bucket for another application

Please don't treat these technologies as completely new to me. We can deepen my understanding of them, but I'd like to prioritize learning technologies that expand my existing capabilities.

## 2. Technologies I want to learn and incorporate

### Priority 1 — TypeScript

Use TypeScript throughout Nearmora wherever appropriate.

I want to learn:

- Interfaces and type aliases
- Union types and type narrowing
- Generics
- Type-safe React components and hooks
- Typed application state
- Typed asynchronous functions
- Runtime validation where TypeScript alone is insufficient
- Error handling and strict compiler settings

Explain important TypeScript concepts when introducing them, particularly how they differ from JavaScript.

### Priority 2 — SQL and relational databases

Use **SQLite** for Nearmora's local application database.

Consider Drizzle ORM if it meaningfully improves type safety and maintainability.

I want experience with:

- Relational database design
- Primary and foreign keys
- SQL queries and joins
- Database normalization
- Indexes
- Migrations
- Transactions
- Query optimization
- Data integrity

Design a database that can manage photos, file references, metadata, events, favorites, review decisions, albums, and creative projects.

I would also like to learn **PostgreSQL** later through a genuinely useful hosted feature or separate learning exercise, rather than introducing a cloud database unnecessarily.

### Priority 3 — Automated testing

Introduce a professional testing strategy using:

- Vitest for unit testing
- React Testing Library for component testing
- Playwright for end-to-end testing where appropriate

Prioritize tests for:

- Photo importing
- Duplicate and similarity grouping
- Favorite selection
- Photo comparison
- Database operations
- Error handling
- Export functionality
- Non-destructive file management

Photo originals must never be unexpectedly deleted or modified.

Teach me how to distinguish unit, integration, and end-to-end tests and when each is appropriate.

### Priority 4 — Next.js

I want hands-on experience with Next.js because it frequently appears in frontend job descriptions.

However, Nearmora's desktop application should remain React + TypeScript + Vite + Electron unless there's a compelling architectural reason to change it.

Use **Next.js for Nearmora's public marketing website**, potentially including:

- Landing page
- Product information
- SEO metadata
- Download page
- FAQ
- Future documentation or blog
- Responsive layouts

Introduce server components, client components, routing, and rendering strategies where appropriate.

Do not force Next.js into the desktop application simply to satisfy this learning objective.

### Priority 5 — Docker

I'd like to learn Docker and containerization.

Identify a practical use case, such as containerizing the marketing website or a future backend service.

Teach me:

- Images versus containers
- Dockerfiles
- Multi-stage builds
- Environment configuration
- Docker Compose when appropriate
- Development versus production environments

Do not require Docker for Nearmora's desktop application unless it provides a clear benefit.

### Priority 6 — Modern frontend architecture

I also want exposure to professional frontend patterns, including:

- Tailwind CSS, if appropriate for the design system
- Reusable component architecture
- Accessible component primitives
- Zustand or another lightweight state-management solution when needed
- React performance optimization
- Virtualized photo grids
- Lazy loading
- Memoization when justified
- Background processing
- Error boundaries
- Code splitting
- Performance profiling

Nearmora must maintain its warm, cozy, photography-first aesthetic. Do not allow a component library or CSS framework to make it look like a generic SaaS dashboard.

## 3. Technologies I already use but want to deepen

Continue applying good CI practices.

I already have experience configuring automated checks that block pull-request merges when validation fails.

For Nearmora, recommend an appropriate workflow for:

- Linting
- Type checking
- Automated tests
- Build verification
- Pull-request validation
- Protected branches
- Release preparation

I am also learning AWS through another project. Avoid requiring AWS for Nearmora's local photo library. We can revisit cloud services when they offer a clear product benefit.

## 4. Architecture and privacy requirements

Nearmora should be:

- Desktop-first
- Local-first
- Privacy-conscious
- Non-destructive
- Designed for large photo libraries
- Maintainable and scalable

The application should never require users to upload their private photos to a cloud service for basic organization.

Use secure Electron architecture, including process isolation, limited filesystem permissions, and carefully designed communication between the UI and the desktop backend.

Store application metadata separately from original photo files.

Do not modify, move, or delete originals without explicit user consent.

## 5. How I want you to teach me

Please act as a senior software engineer mentoring a junior developer.

For each major technical decision:

1. Explain what the technology does.
2. Explain why it belongs in Nearmora.
3. Identify what engineering skill I'll learn.
4. Explain the tradeoffs and alternatives.
5. Give me manageable implementation milestones.
6. Identify the tests and acceptance criteria.
7. Help me understand the code rather than simply generating it.

Don't introduce unnecessary dependencies or overengineer the application.

If a technology is useful for career development but doesn't belong in the MVP, recommend learning it through a later feature or separate exercise.

## 6. Portfolio and interview readiness

As we develop Nearmora, help me document meaningful engineering accomplishments.

Track:

- Technical challenges
- Architectural decisions
- Performance measurements
- Testing improvements
- Bugs and how they were resolved
- Security and privacy decisions
- Tradeoffs
- Lessons learned

Eventually, I want to be able to explain Nearmora confidently in technical interviews and describe the technologies I've personally implemented.

Do not fabricate performance metrics, skills, or accomplishments.

## 7. First deliverable

Before changing any code, review our existing Nearmora product blueprint and proposed architecture.

Create a **Technical Learning & Implementation Roadmap** containing:

1. Recommended technology stack
2. Which technologies belong in the MVP
3. Which technologies should be introduced after the MVP
4. Learning objectives for each technology
5. Implementation order and dependencies
6. Testing and acceptance criteria
7. Portfolio value of each milestone
8. Risks of overengineering

Flag anything that conflicts with Nearmora's core mission.

**Do not begin implementation until I approve the roadmap.**