# Діаграми архітектури та поведінки

Цей документ містить діаграми, що описують структуру та поведінку плагіну `joplin-plugin-my-calendar`.

## 1. Поведінкова діаграма користувача (User Flow)

Ця діаграма показує покроковий шлях користувача: від відкриття плагіну до конкретних дій (навігація, перегляд, імпорт).

```mermaid
flowchart TD
    Start([Початок]) --> OpenPlugin{Відкрити плагін}
%% Шляхи відкриття
    OpenPlugin -->|" Меню: View -> Toggle My Calendar "| PanelVisible
    OpenPlugin -->|" Тулбар: Кнопка календаря "| PanelVisible
    OpenPlugin -->|" Шорткат: Ctrl+Alt+C "| PanelVisible
    OpenPlugin -->|" Команда: mycalendar.open "| PanelVisible
%% Головна панель
    subgraph Panel ["Панель My Calendar"]
        PanelVisible[Відображення Місяця]
    %% Навігація по календарю
        PanelVisible -->|" Клік 'Next Month' "| NextMonth[Завантажити наступний місяць]
        PanelVisible -->|" Клік 'Prev Month' "| PrevMonth[Завантажити попередній місяць]
        NextMonth --> PanelVisible
        PrevMonth --> PanelVisible
    %% Взаємодія з днями
        PanelVisible -->|" Клік на дату "| SelectDate[Вибрати день]
        SelectDate --> ShowDayEvents[Показати список подій дня]
    %% Взаємодія з подіями
        ShowDayEvents -->|" Клік на подію "| OpenNote[Відкрити нотатку в Joplin]
    %% Імпорт ICS
        PanelVisible -->|" Вставити ICS текст "| ImportArea[Секція ICS Import]
        ImportArea -->|" Вибрати папку "| SelectFolder[Вибір цільової папки]
        ImportArea -->|" Клік 'Import' "| ProcessImport[Обробка імпорту]
        ProcessImport -->|" Успіх "| UpdateView[Оновлення календаря]
        ProcessImport -->|" Помилка "| ShowError[Показати повідомлення про помилку]
    %% Експорт ICS (якщо налаштовано)
        PanelVisible -->|" Клік 'Export' (Посилання) "| ExportICS[Експорт календаря у файл]
    end

%% Налаштування
    PanelVisible -.->|" Зміна налаштувань Joplin "| Settings
    subgraph Settings ["Налаштування Joplin"]
        ConfigWeek[Початок тижня]
        ConfigVisuals[Показ часової шкали]
        ConfigSync[Період оновлення подій]
        ConfigImport["Налаштування імпорту (Alarms, Range)"]
        ConfigExport[Посилання для експорту]
    end

    Settings -->|Зберегти| RefreshView[Автоматичне оновлення панелі]
    RefreshView --> PanelVisible
%% Фонова синхронізація
    SystemSync[Синхронізація Joplin/Зміна нотатки] -.->|" Подія Sync/Change "| InvalidateCache[Очистка кешу подій]
    InvalidateCache --> PanelVisible
%% Закриття
    PanelVisible -->|" Toggle/Close "| Stop([Закрити панель])
```

## 2. Діаграма станів (State Diagram)

Ця діаграма фокусується на життєвому циклі плагіну та його внутрішніх станах.

```mermaid
stateDiagram-v2
    [*] --> Hidden: Запуск Joplin

    state Hidden {
        state "Приховано (Hidden)" as HiddenTitle
        [*] --> Idle
        Idle --> BackgroundSync: Зміна нотатки/Синхронізація
        BackgroundSync --> Idle: Оновлення кешу
    }

    Hidden --> Visible: Команда Toggle / Open
    Visible --> Hidden: Команда Toggle / Закриття

    state Visible {
        state "Відкрито (Visible)" as VisibleTitle
        [*] --> MonthView

        state MonthView {
            [*] --> RenderGrid
            RenderGrid --> WaitingForInteraction
            WaitingForInteraction --> ChangeMonth: Навігація
            ChangeMonth --> RenderGrid
            WaitingForInteraction --> DateSelected: Клік на дату
        }

        state DateSelected {
            [*] --> FetchDayEvents
            FetchDayEvents --> DisplayList
            DisplayList --> OpenJoplinNote: Клік на подію
            OpenJoplinNote --> DisplayList
        }

        state Importing {
            [*] --> ParsingICS
            ParsingICS --> UpdatingNotes: Створення/Оновлення нотаток
            UpdatingNotes --> UpdateAlarms: Синхронізація нагадувань
            UpdateAlarms --> ImportFinished
        }

        MonthView --> Importing: Вставка ICS та Імпорт
        Importing --> MonthView: Завершення/Оновлення
    }
```
