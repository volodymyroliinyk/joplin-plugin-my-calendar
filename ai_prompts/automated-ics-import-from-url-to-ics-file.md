- need to develop new feature:
    - for example, Google provides links like
      this https://calendar.google.com/calendar/ical/volodymyr.oliinyk.name%40gmail.com/private-c559d7f8255bcfc8a7f79f98baecaaab/basic.ics
    - Add a new plugin setting property (textarea if joplin supports this or input) ics links + notebook titles, which
      support few links+notebook titles like with separators (запропонуй найкращий символи сепараторів). Automated
      import works if those links are valid, secure and not empty and notebook titles are valid, secure and note empty
      and exists. This property is visible just for the desktop plugin version. Тобто плагін підтримує автоматичний
      імпорт безкінечну пару валідних і безпечних і існуючих "ics link + notebook title" пар!
    - automated import works just on Desktop plugin version.
    - Способи запуску імпорту, для дискусії з тобою, можливо найкращий спосіб з інтервалом у хвилинах, які юзер задає з
      іншого нового plugin setting property (minutes).
    - цей імпорт використовує, що існують класи, методи для імпорту, які вже використовуються у формі імпорту
    - після імпорту успішного чи не успішного мають з'являтися тостер сповіщення, подібні чи ті самі тостери, які
      вистрибують після імпорту з форми; самі `ics` посилання або їх частини ніколи не можна включати в текст сповіщень,
      помилок, логів чи інших user-facing повідомлень, бо вони можуть містити секретні ідентифікатори.
    - додати нові тест кейси, тести
    - оновити readme
    - запропонувати назву гілки git, git commit під цю нову можливість.
    - якщо в тебе є питання, уточнення задавай, пропозиції кращі за мої ідеї пропонуй.
    - так, імпорт кожного ics посилання має відбувати в окремий свій notebook, треба задавати назву нотатника разом з
      посиланням!
- Фікснути баг: при автоматичному імпорті зявляється кешований тостер повідомлення привид при виході з налаштувань на
  основну сторінку Joplin додатка. треба знайти причину і фікснути.
