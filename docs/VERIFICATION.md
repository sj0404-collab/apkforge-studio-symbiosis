# Проверки: что запускалось и что ответило

Всё ниже — реальный вывод, снятый в этом окружении 2026-10-31. Где проверка
невозможна без устройства или NDK, это сказано прямо.

---

## 1. Symbiosis: Kotlin-тесты на хосте

Тулчейн: `kotlinc 2.0.21`, JDK 11, каждая тест-фикстура собирается и
запускается отдельно.

```bash
kotlinc tests/LibraryIndexTest.kt patch/android/utils/LibraryIndex.kt \
  -include-runtime -d li.jar && java -jar li.jar
```

```
PASS ConverterTest
PASS DeepLibraryTest
PASS FolderScanTest
PASS GameCountTest
PASS GameFormatsTest
PASS HomeExtrasTest
PASS LauncherRailTest
PASS LauncherUiTest
PASS LazyScanTest
PASS LibraryIndexTest
PASS PanelAssetsTest
PASS PluginPackTest
PASS RedirectTest
PASS SaveSourceTest
PASS SetupPageTest
PASS SpacesTest
PASS UtilitiesRedirectTest
== kotlin pass=17 fail=0 nobuild=0
```

Проверок внутри: `LibraryIndexTest` — 65, `LauncherRailTest` — 41,
`DeepLibraryTest` — 32, `GameCountTest` — 8.

Что именно держит новый тест (выдержка):

```
ok    nsz: вид   [получено COMPRESSED, ожидалось COMPRESSED]
ok    nsz: не запускается
ok    nsz: причина понятна   [сжатый образ · сначала «Распаковать» во вкладке Конвертер]
ok    две части - одна запись
ok    main без точки: id берётся безопасно
ok    сводка: сжатых   [получено 200, ожидалось 200]
ok    сводка: сжатые названы в строке   [211 файлов · 4 игры · 2 обновл. · 3 DLC · 200 сжатых …]
ok    GameHelper берёт правило из LibraryIndex
ok    GameHelper не режет id через lastIndexOf(".")
ok    GameHelper не теряет файл при null от getGame
ok    сканер не режет обход на 400 папках
ok    docs/ и assets/ совпадают байт в байт
```

Две регрессии зафиксированы отдельно: `main` без точки (пункт 1.2 отчёта о
багах) и «обновление/DLC — не отдельная игра».

---

## 2. Symbiosis: страница в JSDOM

```bash
node tools/lab-test.mjs
```

```
── обычная библиотека: 251 файлов · 24 игры · 24 обновл. · 16 DLC · 180 сжатых → Конвертер · 7 прочих
── 600 файлов: 742 файлов · 120 игр · 120 обновл. · 80 DLC · 400 сжатых → Конвертер · 22 прочих
── только сжатые: 250 файлов · 0 игр · 250 сжатых → Конвертер
passed=39 failed=0
```

39 = 13 проверок × 3 пресета. Проверки выполняются **в мире страницы**
(`window.eval` внутри JSDOM / iframe), то есть зовут её собственные
`GAMES`, `railGames()`, `visibleGames()`, `whyNot()`, `deadAction()`.

Ключевые строки:

```
ok    видны все файлы, а не один   [742 из 742]
ok    сжатые файлы в списке, а не выброшены   [400 сжатых]
ok    карусель отдаёт всю библиотеку, мёртвые помечены   [742 из 742, не запускаются 422, помечено 422]
ok    поиск не режет карусель (v21)   [742 -> 742]
ok    тап по сжатому не запускает сессию   [launch: 0 -> 0]
ok    у сжатого есть кнопка «Распаковать»   [кнопка true, вызовов convertPath 1]
ok    «почему?» открывает разбор, а не пустоту   [открыт true, строк 43]
```

Это и есть ответ на исходную жалобу: при 742 файлах страница показывает 742
строки, 120 из них — игры, 400 — сжатые с кнопкой распаковки, и ни одно
нажатие на сжатый файл не пытается запустить сессию.

---

## 3. Студия

```bash
npm run lint    # eslint .
```

```
✖ 0 problems
```

(до правок было 2 ошибки: неиспользуемый импорт `getBigFile` и сломанная
регулярка в проверке темы)

```bash
npm run build   # tsc -b && vite build
```

```
✓ 3089 modules transformed.
✓ built in 1m 4s
```

---

## 4. Чужая CI: ветка в самом Symbiosis

Ветка `fix/library-sees-all-games` и PR #3 в
`sj0404-collab/symbiosis`. Прогон `Tests` — их собственный харнесс, не мой:

```
PASS  LibraryIndexTest — passed=65 failed=0
...
passed=36 failed=0 skipped=3
```

Первый прогон был красным, и это полезнее зелёного: `tools/run_tests.sh`
компилирует каждый `tests/*.kt` **по одному файлу** и отправлял stderr в
`/dev/null`. Мой тест импортирует `LibraryIndex`, из одного файла не
собирался, и об этом сообщалось как «FAIL» с причиной
`Unable to access jarfile` — то есть ни о чём.

Что исправлено в харнессе:

* у Kotlin-цикла появился `kt_deps_for` — по образцу `deps_for` для C++:
  тесту подставляются исходники, которые он импортирует (только чистый
  Kotlin; всё, что требует Android, по-прежнему моделируется);
* если сборка не удалась, печатается первая строка ошибки компилятора,
  а не путь к отсутствующему jar.

## 5. CI нового репозитория

```
Studio + Symbiosis Lab   completed   success
```

`npm ci` → `npm run lint` → `npm run build` → `npm run test:lab` →
побайтовое сравнение страницы → Kotlin-тест правила → `git apply --check`.

## 6. Чего проверить не удалось

| Что | Почему |
|---|---|
| `assembleLegacyDebug` / APK | нет NDK и дерева Eden; сборка ~25 минут на раннере. Их `Build APK` запускается только после мёржа в `main` |
| Запуск на телефоне (Mali-G57) | устройства нет |
| Реальная распаковка NSZ | зависит от `externals/zstd` в Android-сборке, локально не воспроизводится |
| Свайп карусели пальцем | JSDOM не имеет композитора; проверены обработчики, не инерция |
| Кол-во кадров, память при 742 строках | нужен браузер с настоящей раскладкой |

Поэтому в README написано «сборка APK не проверена», а не «готово».

---

## 8. Нативный лаунчер и руководство: 68 проверок

Тот же `kotlinc 2.0.21`, тот же стиль — тест собирается вместе с настоящим кодом,
а не с его копией.

```bash
kotlinc tests/NativeLibraryPresenterTest.kt \
  patch/android/utils/NativeLibraryPresenter.kt \
  patch/android/utils/LibraryIndex.kt \
  patch/android/utils/Manual.kt \
  -include-runtime -d np.jar && java -jar np.jar
```

```
passed=68 failed=0
```

Хвост вывода, дословно:

```
  ok    лаунчер есть в навигации
  ok    стартовый экран — нативный лаунчер
  ok    в руководстве есть раздел «с чего начать»
  ok    разделов не меньше шести   [7]
  ok    каждый шаг объясняет, а не только называет
  ok    поиск находит конвертер   [3]
  ok    кнопки руководства ведут на разные экраны   [[KEYS, FOLDERS, CONVERT, TOOLS, FPS, DIAGNOSTICS, ENGINES]]
  ok    в текстах руководства нет имён классов
  ok    экран руководства существует
  ok    руководство берёт текст из Manual
  ok    руководство умеет искать
  ok    в руководстве нет WebView
  ok    все экраны руководства есть в навигации
  ok    в инструментах есть руководство
  ok    старая панель названа расширенной
```

Две проверки — про дрейф, а не про логику: тест читает
`patch/android/fragments/NativeLauncherFragment.kt`, `ManualFragment.kt`,
`ToolsFragment.kt` и `home_navigation.xml` и падает, если экран перестал звать
презентер, если в нём появился WebView или если `startDestination` снова
указывает не на него. Это ровно те ошибки, которые дают зелёную сборку с
неправильным поведением.

Что не покрыто: сама вёрстка. `fragment_native_launcher.xml` и карточки
руководства проверяются только сборкой в Actions — здесь нет ни aapt2, ни
эмулятора.
