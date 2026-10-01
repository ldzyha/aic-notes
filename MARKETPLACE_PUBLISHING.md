# Marketplace publishing / Публікація в Marketplace

[English](#english) · [Українська](#українська)

## English

Public product documentation: [releases and installation](https://aic.dzyha.com/releases),
[terms and privacy](https://aic.dzyha.com/terms), [AIC Notes](https://aic.dzyha.com/).

### Current status — October 1, 2026

The existing [AIC Notes listing](https://marketplace.visualstudio.com/items?itemName=ldzyha.aic-notes)
under publisher **ldzyha** publicly exposes **58.1.1**, verified in the current
publisher dashboard. **59.0.2 is prepared**, with shared core 7.5.2, natural
Mermaid sizing and live theme refresh. Its GitHub assets, upload acceptance and
public Marketplace availability still require separate verification.

The earlier [verification-only publishing run](https://github.com/ldzyha/aic-notes/actions/runs/36847214736)
checked 57.1.2 release bytes without authenticating or submitting them. It is
historical verification evidence, not proof of a 59.0.2 publication.

Automatic publishing code is prepared. The repository does **not** yet have the
`VSCE_PAT` Actions secret, so authenticated automatic publishing is **not fully
activated or verified**. The existing public version was uploaded manually.
An earlier PAT setup attempt stopped at new Azure DevOps organization creation
because that form required a billing subscription. The current upload used the
existing Marketplace publisher dashboard and did not require that setup.

Source preparation on September 30 adds an optional Microsoft Entra federation
route. It verifies the same stable release VSIX and publisher rights before
submission. Account authorization, federated identity configuration, and a real
authenticated publication remain unverified. The existing VSCE dependency lock
resolves to 3.9.2 and supports `--azure-credential` for both authorization checks
and publication.

### Release flow

1. Push the intended `v<version>` release tag. `release.yml` keeps its existing
   Node 20 build, test and universal-package checks.
2. A tag run calls `publish-marketplace.yml` only after `verify-universal` and the
   GitHub release succeed and repository variable `VSCODE_MARKETPLACE_ENABLED` is
   exactly `true`. Automatic Marketplace submission is disabled by default.
   GitHub releases work without this flag; setting it requires explicit
   authorization to resume Marketplace publishing.
3. The publishing workflow downloads that public stable GitHub release's exact
   `aic-notes-<version>.vsix` and `.sha256`. It checks the checksum, tag/version and
   package identity `ldzyha.aic-notes`, then submits those bytes without rebuilding.
   Draft or prerelease assets are not accepted.
4. If that version is already in Marketplace, the workflow explicitly skips the
   duplicate. It does not replace an existing version or increment the version.

Open [Publish Marketplace in Actions](https://github.com/ldzyha/aic-notes/actions/workflows/publish-marketplace.yml)
and choose **Run workflow** from **main**:

- To check an existing release without publishing, set `release_tag` (for example,
  `v53.0.1`) and **verification_only = true**. This downloads and verifies the
  assets; it requires no PAT and skips credential checks and publication.
- To publish or retry, set the existing stable `release_tag` and leave
  **verification_only = false**. The workflow verifies the publisher credential
  before submitting the VSIX.

Verification-only and duplicate-only runs do not prove that the pipeline can
publish a new version. Record a successful authenticated publication before
calling automatic publishing operational.

### Select publishing authentication

For Entra publication, set repository variables `VSCE_AUTH_MODE=entra`,
`VSCE_AZURE_CLIENT_ID`, and `VSCE_AZURE_TENANT_ID`. Authorize that identity as a
contributor to publisher **ldzyha** and configure Entra workload federation for
the GitHub repository's publishing refs. The workflow uses Azure Login with
`allow-no-subscriptions: true`, followed by `vsce --azure-credential`. The source
route is prepared; it still needs owner account setup and a successful publishing
run. [Prepared setup](https://github.com/ldzyha/standard-notes-aic/blob/main/pwa/EXTENSION_UPDATES.md#vs-code-publication),
[Microsoft publishing guidance](https://code.visualstudio.com/api/working-with-extensions/publishing-extension#secure-automated-publishing-to-visual-studio-marketplace).

`VSCE_AUTH_MODE=pat` or an unset mode preserves the existing temporary PAT route:

Creating a **new Azure DevOps organization** requires an active Azure
subscription; existing organizations and free-tier limits are unaffected.
[Microsoft prerequisites](https://learn.microsoft.com/en-us/azure/devops/organizations/accounts/create-organization?view=azure-devops).
This is an organization-creation requirement, not a claim that every publisher
or authentication route needs a subscription. Existing manual Marketplace
uploads and VS Code client updates do not require this setup.

1. Use the Microsoft account authorized to manage publisher **ldzyha**. In Azure
   DevOps, create a short-lived PAT with **All accessible organizations** and
   custom scope **Marketplace → Manage**. [Official PAT setup](https://code.visualstudio.com/api/working-with-extensions/publishing-extension#get-a-personal-access-token).
2. Open [repository Actions secrets](https://github.com/ldzyha/aic-notes/settings/secrets/actions),
   choose **New repository secret**, name it exactly `VSCE_PAT`, and paste the
   token there. Do not put it in chat, source files, Git or workflow YAML.
3. Run the publishing workflow for the next verified release, inspect its result,
   and confirm the version on the public listing. Rotate the secret before its
   expiry; revoking the old PAT must accompany credential replacement.

This PAT setup is temporary. Microsoft retires global Azure DevOps PATs on
**December 1, 2026**; rotation cannot extend that deadline. Migrate publishing to
Microsoft Entra ID authentication before then. [Retirement notice](https://devblogs.microsoft.com/devops/retirement-of-global-personal-access-tokens-in-azure-devops/).

The Entra route uses Azure Login's GitHub workload federation and the supported
`vsce --azure-credential` interface. It does not depend on the unannounced native
`vsce --oidc` publishing flag. [Azure Login federation](https://github.com/Azure/login#login-with-openid-connect-oidc-recommended),
[official vsce change](https://github.com/microsoft/vscode-vsce/pull/1297).

### What users receive

Marketplace installations follow VS Code's automatic-update settings. An earlier
VSIX installation needs **Auto Update** enabled for AIC Notes if the user wants
Marketplace updates. [VS Code update behavior](https://code.visualstudio.com/docs/configure/extensions/extension-marketplace#extension-auto-update).

This pipeline does not publish to Open VSX. code-server uses Open VSX, so its
store distribution needs a separate setup; the GitHub VSIX remains the manual
installation path. [code-server extension sources](https://coder.com/docs/code-server/FAQ#why-cant-code-server-use-microsofts-extension-marketplace).

---

## Українська

Публічна документація продукту: [випуски та встановлення](https://aic.dzyha.com/releases),
[умови й приватність](https://aic.dzyha.com/terms), [AIC Notes](https://aic.dzyha.com/).

### Поточний стан — 1 жовтня 2026

Наявний [запис AIC Notes](https://marketplace.visualstudio.com/items?itemName=ldzyha.aic-notes)
від видавця **ldzyha** публічно надає **58.1.1**; це перевірено в поточній панелі
видавця. **59.0.2 підготовлено** зі спільним ядром 7.5.2, природними розмірами
Mermaid та оновленням кольорів при зміні теми. Файли GitHub, прийняття завантаження
та доступність 59.0.2 у Marketplace ще перевіряються окремо.

Попередній [запуск лише для перевірки](https://github.com/ldzyha/aic-notes/actions/runs/36847214736)
звірив файли 57.1.2 без авторизації та подання. Це історичний результат,
а не підтвердження публікації 59.0.2.

Код автоматичної публікації підготовлений. У репозиторії **ще немає** Actions
secret `VSCE_PAT`, тому автоматична публікація з авторизацією **ще не повністю
активована й не перевірена**. Наявну публічну версію завантажено вручну.
Попередня спроба налаштувати PAT зупинилася на створенні нової організації
Azure DevOps через вимогу підписки для білінгу. Поточне завантаження виконано
через наявну панель видавця Marketplace без цього налаштування.

Підготовка коду 30 вересня додає optional Microsoft Entra federation route.
Він перевіряє той самий стабільний VSIX і права видавця перед поданням.
Account authorization, налаштування federation та реальна публікація з
авторизацією ще не перевірені. Наявний dependency lock VSCE задає 3.9.2 із
підтримкою `--azure-credential` для перевірки прав і публікації.

### Порядок випуску

1. Надішліть потрібний тег `v<version>`. `release.yml` зберігає наявні збірку,
   тести й перевірку універсального пакета на Node 20.
2. Запуск за тегом викликає `publish-marketplace.yml` лише після успішних
   `verify-universal` і GitHub release, коли змінна репозиторію
   `VSCODE_MARKETPLACE_ENABLED` дорівнює `true`. Автоматичне подання до Marketplace
   типово вимкнене. GitHub releases працюють без цього прапорця; його ввімкнення
   потребує явного дозволу відновити публікацію в Marketplace.
3. Workflow публікації завантажує точні `aic-notes-<version>.vsix` і `.sha256`
   цього публічного стабільного GitHub release. Він звіряє контрольну суму,
   тег/версію та ідентичність `ldzyha.aic-notes`, потім надсилає ті самі байти без
   повторної збірки. Чернетки й prerelease не приймаються.
4. Якщо версія вже є в Marketplace, workflow явно пропускає дублікат. Наявна
   версія не замінюється, номер не підвищується автоматично.

Відкрийте [публікацію Marketplace в Actions](https://github.com/ldzyha/aic-notes/actions/workflows/publish-marketplace.yml),
виберіть гілку **main** та **Run workflow**:

- Щоб перевірити наявний випуск без публікації, задайте `release_tag` (наприклад,
  `v53.0.1`) та **verification_only = true**. Режим завантажує й перевіряє
  артефакти, не потребує PAT і пропускає перевірку доступу та публікацію.
- Для публікації або повторної спроби задайте наявний стабільний `release_tag`
  і залиште **verification_only = false**. Workflow перевіряє доступ видавця
  перед надсиланням VSIX.

Перевірка без публікації та пропуск дубліката не доводять можливості випускати
нову версію. Автоматизація вважається робочою після підтвердженої публікації
з авторизацією.

### Вибір авторизації для публікації

Для Entra задайте repository variables `VSCE_AUTH_MODE=entra`,
`VSCE_AZURE_CLIENT_ID` і `VSCE_AZURE_TENANT_ID`. Додайте identity до publisher
**ldzyha** із роллю Contributor та налаштуйте Entra workload federation для
publishing refs GitHub repository. Workflow використовує Azure Login із
`allow-no-subscriptions: true`, потім `vsce --azure-credential`. Route у коді
підготовлено; налаштування акаунта власником і успішний publishing run ще
потрібні. [Підготовлене налаштування](https://github.com/ldzyha/standard-notes-aic/blob/main/pwa/EXTENSION_UPDATES.uk.md#публікація-vs-code),
[інструкція Microsoft](https://code.visualstudio.com/api/working-with-extensions/publishing-extension#secure-automated-publishing-to-visual-studio-marketplace).

`VSCE_AUTH_MODE=pat` або незаданий mode зберігає попередній тимчасовий PAT route:

Створення **нової організації Azure DevOps** потребує активної Azure subscription;
наявні організації та ліміти безкоштовного рівня не змінюються.
[Вимоги Microsoft](https://learn.microsoft.com/en-us/azure/devops/organizations/accounts/create-organization?view=azure-devops).
Це вимога створення організації, а не всіх видавців чи способів авторизації.
Наявна ручна публікація в Marketplace та оновлення у клієнті VS Code не потребують
цього налаштування.

1. Використайте Microsoft-акаунт із правом керувати видавцем **ldzyha**. В Azure
   DevOps створіть PAT із коротким терміном дії, **All accessible organizations**
   та окремим дозволом **Marketplace → Manage**. [Офіційне налаштування PAT](https://code.visualstudio.com/api/working-with-extensions/publishing-extension#get-a-personal-access-token).
2. Відкрийте [Actions secrets репозиторію](https://github.com/ldzyha/aic-notes/settings/secrets/actions),
   виберіть **New repository secret**, назвіть його точно `VSCE_PAT` і вставте
   токен туди. Не передавайте токен у чат, файли коду, Git чи workflow YAML.
3. Запустіть публікацію наступного перевіреного випуску, перегляньте результат і
   звірте версію на публічній сторінці. Замінюйте secret до завершення терміну дії
   та відкликайте попередній PAT після заміни.

PAT — тимчасовий спосіб. Microsoft вимикає глобальні Azure DevOps PAT
**1 грудня 2026 року**; заміна токена не подовжує цей строк. До цієї дати
перенесіть публікацію на авторизацію Microsoft Entra ID. [Повідомлення про вимкнення](https://devblogs.microsoft.com/devops/retirement-of-global-personal-access-tokens-in-azure-devops/).

Entra route використовує GitHub workload federation через Azure Login і
підтримуваний `vsce --azure-credential`. Він не залежить від неанонсованого
native publishing flag `vsce --oidc`. [Azure Login federation](https://github.com/Azure/login#login-with-openid-connect-oidc-recommended),
[офіційна зміна vsce](https://github.com/microsoft/vscode-vsce/pull/1297).

### Оновлення у користувачів

Інсталяції з Marketplace дотримуються налаштувань автооновлення VS Code. Для
попередньої інсталяції через VSIX потрібно увімкнути **Auto Update** для AIC Notes,
якщо потрібні оновлення з Marketplace. [Оновлення у VS Code](https://code.visualstudio.com/docs/configure/extensions/extension-marketplace#extension-auto-update).

Цей pipeline не публікує в Open VSX. code-server використовує Open VSX, тому
його магазинний канал налаштовується окремо; VSIX із GitHub залишається способом
ручного встановлення. [Джерела розширень code-server](https://coder.com/docs/code-server/FAQ#why-cant-code-server-use-microsofts-extension-marketplace).
