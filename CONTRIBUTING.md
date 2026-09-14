# Contributing to Chuti

First off, thank you for considering contributing to Chuti! It's people like you that make open-source software such a great community to learn, inspire, and create.

## Where do I go from here?

If you've noticed a bug or have a feature request, please make sure to check our **Issue Tracker** to see if someone else has already opened an issue for it. If not, go ahead and open a new one using our provided templates!

## Setting up your local environment

1. **Fork** the repository on GitHub.
2. **Clone** your fork locally:
   ```bash
   git clone https://github.com/zihaaaad/Chuti.git
   cd Chuti
   ```
3. **Install Dependencies**:
   Ensure you have Node.js (v18+) installed.
   ```bash
   npm install
   ```
4. **Run the Development Server**:
   ```bash
   npm run dev
   ```
   The server will start at `http://localhost:3000`.

## Making Changes

- Create a new branch for your feature or bugfix:
  ```bash
  git checkout -b feature/my-awesome-feature
  ```
- Make your changes.
- **Run the checks** before committing. CI runs the same three:
  ```bash
  npm run lint
  npm run typecheck
  npm test
  ```
- **Leave rules belong in `src/lib/domain/`** as pure functions with tests. Server Actions should only validate input (zod schemas in `src/lib/validation.ts`), call `adminAction`, and do their writes inside `withTransaction`.
- **Schema changes** go in a new entry at the end of `src/lib/migrations.ts`. Never edit a migration that has shipped.
- Commit your changes with clear, descriptive commit messages.
- Push to your fork and submit a Pull Request against the `master` branch.

## Pull Request Process

1. Ensure your PR description clearly describes the problem and solution.
2. Link any relevant open issues.
3. Wait for maintainers to review your code. We may request some changes before merging.

Thank you for contributing!
