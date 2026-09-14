# Локальные regression checks

Требуются Node.js 22+ и Python 3. Без npm-зависимостей и внешнего test framework.
Работать из корня **существующего** knowledge-studio. Использовать отдельный тестовый
browser profile/origin. Эти сценарии создают записи `Regression …`, изменяют настройки
тестовой библиотеки, проверяют restore; не запускайте их на рабочем пользовательском origin.
Никакой тест не удаляет IndexedDB целиком.

```powershell
node tests/check.mjs
python -B tests/serve.py --port 8766
```

В реальном Chromium откройте по порядку:

1. `http://127.0.0.1:8766/knowledge-studio/tests/runtime.html` → «Запустить regression».
   Дождитесь `PASS runtime suite complete`. Проверяются все 21 вида блоков, CRUD,
   Editor/Reader/Focus, 32 темы, 12 routes при пяти размерах iframe, scroll,
   PDF UI import, CJK/CMap, JPEG2000/WASM, backup/restore, rollback и SW scope.
2. `http://127.0.0.1:8766/knowledge-studio/tests/extra.html` → «Дополнительные проверки».
   Дождитесь `PASS additional suite complete`: autosave/reload, draft recovery,
   конфликт записи, Reader modes, reduced motion, dialogs, Blob fallback, reorder/trash.
3. `http://127.0.0.1:8766/knowledge-studio/tests/final.html` → `Recovery / integrity`.
   Проверяются восстановление stale draft отдельной темой, rollback транзакции restore,
   чтение backup v1, отказ экспорта при отсутствующем PDF. Кнопка `Course cover image`
   дополнительно проверяет настоящий PNG, его декодирование, сохранение обложки,
   reload и наличие изображения в backup. Между прогонами можно reload.

Сборка приложения должна быть одинаковой в кэше SW и на сервере. При изменении
production-файлов повысьте `VERSION` в `sw.js` и примените предложенное обновление.
Не очищайте пользовательскую IndexedDB или чужие caches для обновления.

## Проверка SW update

На `final.html` нажмите `Prepare SW update`. Снимок сохраняется в sessionStorage.
Оставьте страницу открытой, измените **только VERSION** в `sw.js` на новое уникальное
значение, затем нажмите `Apply waiting update with unsaved input`.
Тест запускает настоящий `registration.update()`, вводит текст, проверяет durable draft,
нажимает штатную кнопку обновления и дожидается reload. Нажмите `Verify update / reload / offline`.
Должны сохраниться записи, PDF assets, настройки, свежий ввод и посторонний cache.
Старый cache этого приложения должен быть удалён. Между Prepare и Verify не запускайте
другие сценарии, изменяющие библиотеку: сравнивается точный снимок.

Остановите сервер Ctrl+C. Повторите Verify в уже открытой странице (не reload harness).
Отдельно перезагрузите приложение `http://127.0.0.1:8766/knowledge-studio/`, откройте
Reader, Search и PDF оригинал. Это проверяет отсутствие сети без очистки данных.
Верните сервер прежней командой, выполните обычный reload и Ctrl+Shift+R приложения.
Проверьте Console на errors/unhandled rejections и фактический UI после каждого шага.

## Миграция

В отдельном терминале и **свежем тестовом browser profile**:

```powershell
python -B tests/serve.py --port 8767
```

Откройте `http://127.0.0.1:8767/knowledge-studio/tests/migration.html` и запустите тест.
Он создаёт schema 3 с записью, проверяет blocked и сохранную миграцию в schema 4,
затем versionchange в schema 5 и безопасный отказ downgrade. Повторный запуск в том
же profile/origin намеренно запрещён. Используйте свежий профиль или резервный порт
8768 (он тоже разрешён тестом). Не удаляйте существующую базу ради повторного теста.

## Визуальный контроль

Проверенные размеры: 1440×900, 1280×800, 800×1280, 390×844, 844×390.
Основной набор использует реальный browser layout iframe; дополнительно проверяйте
отдельную вкладку с viewport override, темы/диалоги/Editor, длинные названия и таблицы.
После проверки сбросьте override. Это не заменяет запуск на физическом Android или
проверку системного install dialog. Manifest, PNG icons, start_url/scope и subpath
проверяет `check.mjs`; ОС-установка и опубликованный deployment проверяются отдельно.

`fixtures/jpeg2000.pdf` — собственный небольшой PDF с JPXDecode, без пользовательских данных.
Текстовый и японский PDF генерируются `runtime.js` с корректной таблицей xref.
Тестовые страницы не подключаются production-кодом и не входят в app-shell cache.
