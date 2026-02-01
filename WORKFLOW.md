# 🚀 Development Workflow Guide

This document outlines the development process, branching strategy, and commit conventions used in this project.
Following these guidelines ensures code quality, consistency, and automated releases.

---

## 📋 General Workflow

The development process is divided into several key stages:

### 1. Start of Work

- **Create a Branch**: Always start new work on a dedicated branch. Never commit directly to `main`.
  ```bash
  # For a new feature
  git checkout -b feature/new-calendar-view;

  # For a bug fix
  git checkout -b fix/timezone-bug;
  ```

### 2. Development Loop

- **Write Code**: Implement your feature or fix.
- **Commit Changes**: Use the **Conventional Commits** standard for your commit messages. This is critical for automated
  changelog generation.
  ```bash
  git commit -m "feat: add monthly calendar view";
  ```
- **Automated Checks (Husky)**: When you commit, a pre-commit hook will automatically run the linter (`npm run lint`).
  If there are errors, the commit will be aborted, preventing bad code from entering the history.

### 3. Pre-Release Checks

- **Run Local Checks**: Before pushing, run the `pre-pack.sh` script. It ensures that the code is lint-free and all
  tests pass.
  ```bash
  bash ./scripts/pre-pack.sh;
  ```
- **Manual QA**: Test the generated `.jpl` file on both Desktop and Mobile to ensure everything works as expected.

### 4. Merging

- **Pull Request (PR)**: Create a Pull Request from your branch into `main`. This is the preferred way to merge changes,
  even if you are the only developer.
- **Pre-Push Hook**: When you push to `main`, a pre-push hook will verify that tests have passed recently, preventing
  broken code from being merged.

### 5. Preview Changelog

Before running a release, you can preview how the `CHANGELOG.md` will look. This is useful to verify that all commits
are correctly categorized and the version bump is as expected.

- **Check next Patch version**:
  ```bash
  npm run changelog:preview;
  ```

- **Check next Minor version**:
  ```bash
  # Using the script directly
  bash scripts/preview-changelog.sh minor;

  # Or via npm (requires extra dashes)
  npm run changelog:preview -- minor;
  ```

### 6. Release

- **Run the Release Script**: Use the `release.sh` script to automate the entire release process.
  ```bash
  bash ./scripts/release.sh [patch|minor|major];
  ```
  This script will:
  1. Analyze commits since the last tag.
  2. Automatically generate `CHANGELOG.md`.
  3. Bump the version number.
  4. Create a new git tag and push it.
  5. Publish the new version to NPM.

---

## 🌿 Branch Naming Convention

Use the following format for branch names to keep the repository organized:

`<type>/<short-description-in-kebab-case>`

**Branch Types:**

- **`feature/`**: For developing new functionality (e.g., `feature/add-dark-mode`).
- **`fix/`**: For fixing bugs (e.g., `fix/timezone-calculation-error`).
- **`docs/`**: For working with documentation (e.g., `docs/update-readme`).
- **`chore/`**: For maintenance tasks like updating dependencies or CI/CD setup (e.g., `chore/configure-husky`).
- **`refactor/`**: For improving code without changing its behavior (e.g., `refactor/simplify-date-parser`).

---

## ✍️ Commit Message Convention

We use the **Conventional Commits** standard. This allows for automated versioning and changelog generation.

**Format:**
`<type>[optional scope]: <description>`

**Commit Types:**

- **`feat`**: A new feature. Triggers a `minor` version bump (e.g., 1.1.0 -> 1.2.0).
  > `feat: add monthly calendar view`
- **`fix`**: A bug fix. Triggers a `patch` version bump (e.g., 1.1.0 -> 1.1.1).
  > `fix: correct timezone calculation for events`
- **`docs`**: Documentation-only changes.
- **`style`**: Code style changes (formatting, etc.).
- **`refactor`**: Code changes that neither fix a bug nor add a feature.
- **`test`**: Adding or fixing tests.
- **`chore`**: Changes to the build process or auxiliary tools.

**Breaking Changes:**
To indicate a change that breaks backward compatibility, add a `!` after the type or include `BREAKING CHANGE:` in the
commit footer. This triggers a `major` version bump (e.g., 1.0.0 -> 2.0.0).
> `feat!: remove support for old Joplin versions`
>
> `BREAKING CHANGE: This version requires Joplin v2.8 or higher.`
