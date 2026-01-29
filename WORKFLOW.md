# 🚀 Workflow

- [ ] Start of work (Start)
    - [ ] Creating a branch: Always create a new branch for a task. Do not work in main.
        - [ ] git checkout -b feature/new-calendar-view або fix/timezone-bug
- [ ] Development (Development Loop)
    - [ ] Coding.
    - [x] Auto-Check (Husky): New. Configure husky (git hooks). When you do a git commit, it automatically starts lint.
      If there are errors - the commit is not created. This saves time because you don't "contaminate" the history with
      bad code.
    - [ ] Commits (Conventional Commits): Critical for Changelog automation.
        - [ ] Use the standard message format:
            - [ ] feat: add monthly view (for new functionality)
            - [ ] fix: resolve timezone offset (for bugs)
            - [ ] docs: update readme (for documentation)
        - [ ] This will allow the script to automatically understand what will go into the Changelog.
- [ ] Local inspection (Pre-Release)
    - [ ] Running pre-pack.sh: Your script. It ensures that everything goes together and tests pass.
    - [ ] Manual QA: Testing the .jpl file on Desktop and Mobile.
- [ ] Злиття (Merge)
    - [ ] Pull Request: If you use GitHub, it's better to do PR in main.
    - [x] GitHub Actions (CI): New. Configure the .github/workflows/test.yml file. GitHub will automatically run your
      tests (npm run test) on the server with every push or PR. This is "insurance" if you forget to run the local
      tests.
- [ ] Реліз (Release)
    - [ ] Run release.sh:
        - [ ] The script must be updated to:
            - [ ] a. Analyze commits since the last tag.
            - [ ] b. Automatically generate CHANGELOG.md (based on feat and fix).
            - [ ] c. Raise the version.
            - [ ] d. Make tag and push.

---

## Branches

Ось проста і ефективна специфікація, яку я рекомендую:
<тип>/<короткий-опис-через-дефіс>

**Основні типи:**

• feature/: Для розробки нового функціоналу.
◦ feature/add-dark-mode
◦ feature/ics-import-system
• fix/: Для виправлення помилок (багів).
◦ fix/timezone-calculation-error
◦ fix/calendar-grid-display-bug
• chore/: Для завдань, що не стосуються коду (оновлення залежностей, налаштування CI/CD).
◦ chore/update-dependencies
◦ chore/configure-husky
• docs/: Для роботи з документацією (README.md, CHANGELOG.md тощо).
◦ docs/update-readme-with-scripts
• refactor/: Для покращення коду без зміни його поведінки.
◦ refactor/simplify-date-parser

---

## Commits

Так, це можна і варто автоматизувати!

Щоб автоматизувати генерацію CHANGELOG.md, ми використаємо інструмент standard-version (або аналог). Він робить магію:

1. Дивиться на ваші коміти з останнього релізу.
2. Фільтрує їх (бере тільки feat, fix тощо).
3. Оновлює файл CHANGELOG.md.
4. Піднімає версію в package.json.
   Але для цього ви повинні писати коміти за певним стандартом.

---

1. Специфікація Conventional Commits (Як писати коміти)

Вам потрібно дотримуватися простого шаблону: <тип>: <короткий опис>

Основні типи (ці потрапляють у Changelog):

• feat: (Feature) Новий функціонал.
◦ Приклад: feat: add dark mode support
◦ Результат: Підніме версію MINOR (1.1.0 -> 1.2.0).
• fix: Виправлення помилки.
◦ Приклад: fix: correct timezone calculation for events
◦ Результат: Підніме версію PATCH (1.1.0 -> 1.1.1).

Допоміжні типи (зазвичай не потрапляють у Changelog, але корисні):

• docs: Зміни тільки в документації.
◦ Приклад: docs: update installation guide in README
• style: Форматування, пробіли, коми (код не змінюється логічно).
◦ Приклад: style: format code with prettier
• refactor: Зміна коду без виправлення багів чи додавання фіч.
◦ Приклад: refactor: simplify date parsing logic
• test: Додавання чи виправлення тестів.
◦ Приклад: test: add unit tests for ICS parser
• chore: Оновлення білд-скриптів, налаштувань тощо.
◦ Приклад: chore: update dependencies

Breaking Changes (Важливо!):

Якщо ви робите зміни, які ламають сумісність, додайте BREAKING CHANGE: в тіло коміту або ! після типу.
• Приклад: feat!: remove support for old Joplin versions
• Результат: Підніме версію MAJOR (1.0.0 -> 2.0.0).