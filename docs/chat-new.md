# Nový webový Chat a Elowen CLI

## Stav rozhodnutí

- Nová hlavní položka navigace: **Chat** na route `/chat`, hned pod Home.
- Desktopový chat: historie konverzací vlevo, široká konverzace uprostřed.
- Fullscreen: překrytí aplikace ve stejné záložce; `Escape` vrátí původní pohled.
- Elowen CLI: otevře **stejnou konverzaci**, která je aktivní na webu.
- V terminálovém výběru bude samostatná sekce **Elowen CLI** nad sekcí **CLI agenti**.
- Webový tmux a Elowen CLI zůstanou **pouze pro administrátory**. Nová funkce nesmí rozšířit terminálový přístup běžným uživatelům.
- Ani jiný administrátor se nesmí připojit k cizí Elowen CLI relaci; každá relace je vlastněná konkrétním adminem.

## Cíl

Každý uživatel má mít jeden Elowen chat dostupný ve dvou webových prezentacích bez rozdílného chování nebo duplikovaných konverzací:

1. kompaktní chat v současném docku;
2. plnohodnotná stránka `/chat` podobná ChatGPT.

Administrátor může stejnou brain session navíc otevřít ve skutečném TUI `elowen chat` uvnitř webového terminálu. Přepnutí prezentace nesmí zahodit rozepsaný text, rozpojit běžící odpověď ani vytvořit druhý modelový běh.

## Současný stav

- `web/modules/advisor/BrainChat.tsx` již umí historii, vyhledávání, nové konverzace, SSE stream, přílohy, slash příkazy, změnu modelu, otázky, procesy a subagenty.
- `AdvisorPanel` přepíná mezi chatem a terminálovými panely, ale změnou režimu `BrainChat` odpojí a znovu připojí.
- Webový klient dnes většinou pracuje s globální aktivní konverzací; na rozdíl od CLI není důsledně vázaný na explicitní session/client/generation.
- Model se ve webovém chatu mění pouze přes `/model`; není zde trvale viditelný model picker.
- Terminálový režim umí externího CLI advisora a připojení k existujícím tmux relacím. Neumí spustit Elowen chat TUI.
- `/terminal/[name]` a `StreamTerminal` již poskytují interaktivní webový terminál a pop-out.
- Brain API i CLI již podporují pokračování konkrétní konverzace přes `session` / `elowen chat --session <id>`.

## UX návrh

### 1. Hlavní stránka `/chat`

Desktop:

```text
┌──────────┬──────────────────┬────────────────────────────────────────┐
│ globální │ + Nový chat      │ název        model ▾      Terminal ⛶ │
│ navigace │ hledání          │                                        │
│          │ historie         │              konverzace                │
│          │ konverzací       │                                        │
│          │                  │              composer                  │
└──────────┴──────────────────┴────────────────────────────────────────┘
```

- Levý chatový rail obsahuje nový chat, vyhledávání, seznam konverzací, aktivní stav a menu pro přejmenování, export a smazání.
- Hlavní header obsahuje název konverzace, viditelný model picker a fullscreen.
- Tlačítko **Terminál** se renderuje pouze administrátorům; běžný uživatel nemá terminálový affordance ani skrytý způsob startu přes API.
- Transcript má čitelnou maximální šířku; nástroje, diffy, procesy, otázky a subagenti zachovají dnešní schopnosti.
- Composer zůstává dole a podporuje přílohy, frontu zpráv, slash příkazy a průběžné posílání během běžícího turnu.
- Prázdný chat dostane klidný úvodní stav; nevznikne druhý dashboard nebo sada produktových shortcutů.

Mobil:

- Historie je drawer otevřený z headeru.
- Composer respektuje safe-area a virtuální klávesnici.
- Fullscreen je prakticky stejný layout bez globální navigace.

### 2. Fullscreen

- Jedno tlačítko `Maximize2` bude dostupné v docku i na `/chat`.
- Fullscreen použije portál/fixed vrstvu nad shellem (`inset-0`, vlastní správný z-index), nikoli browser Fullscreen API.
- Chat surface musí mít stabilního vlastníka. Pouhé přesunutí stejného JSX mezi inline stromem a portálem nesmí způsobit remount.
- Controller zachová stream a data; surface navíc explicitně zachová textarea selection, scroll transcriptu a fokus.
- `Escape` fullscreen zavře, pokud právě není otevřené menu, modal nebo jiný dialog vlastnící Escape.
- Fokus se po otevření přesune do chatu a po zavření vrátí na spouštěcí tlačítko. Pozadí bude `inert` a scroll stránky zamknutý.

### 3. Terminálový režim — pouze admin

Výběr v terminálové části bude pro administrátora rozdělený:

```text
Elowen CLI
  [Elowen ikona] Aktuální brain model
  Otevřít aktuální konverzaci v CLI

CLI agenti
  Claude / Codex / OpenCode / další povolené execy
```

- Celá sekce **Elowen CLI** i startovací endpoint jsou admin-only.
- Běžný uživatel sekci nevidí a server mu vrátí `403`, i kdyby endpoint zavolal ručně.
- Elowen sekce pouze ukáže aktivní brain model. Změnu modelu vlastní sdílený chatový model picker; druhý model picker v terminálu nevznikne.
- CLI agenti dál používají stávající `allowedExecs`, konfiguraci providerů a `AdvisorService`.
- Po spuštění Elowen CLI vrátí API tmux session a dock ji otevře jako běžný `session` pane přes `StreamTerminal`.
- Opakované kliknutí pro stejnou brain session připojí existující tmux relaci místo spuštění duplikátu.
- Zavření panelu pouze odpojí webový pohled. **Stop** nebo ukončení TUI relaci skutečně ukončí.
- Pop-out terminálu zůstane dostupný přes stávající `/terminal/[name]`.

## Technická architektura

### A. Session-bound chat controller

Rozdělit dnešní monolitický `BrainChat` na:

- `BrainChatProvider` / `useBrainChatController` — session, SSE lifecycle, transcript, draft, přílohy, modely, příkazy, fronta, otázky a mutace;
- `BrainChatSurface` — společný transcript a composer;
- `ChatHistoryRail` — desktopový rail a mobilní drawer;
- `ChatHeader` — název, model, admin-only terminál, fullscreen a session akce;
- `ChatFullscreen` — fullscreen prezentace stejného controlleru a stabilního surface hostu;
- `BrainChat` — tenký kompaktní adapter pro současný dock;
- `ChatView` — plnohodnotný layout route `/chat`.

Provider bude umístěný jednou v `ShellLayout`, nad route contentem i `AdvisorPanel`, ale ne nad chromeless `/terminal/*`. Připojí se lazy při prvním otevření chatu.

Nestačí pouze přesunout současný stav do React contextu. Web musí převzít session binding používaný CLI:

- stabilní `clientId` pro konkrétní browser tab;
- monotónní `generation` při switchi/reconnectu;
- explicitní `session` pro stream, status, historii, send, queue, model, procesy, cíle a příkazy;
- zahození opožděných odpovědí z předchozí generace.

Pravidla hostování:

- mimo `/chat` vykresluje chat dock;
- na `/chat` je hlavní host `ChatView`; dock může být otevřený v režimu Terminál, ale nesmí vykreslit druhý chat surface;
- fullscreen mění prezentaci stabilního surface hostu, nikoli síťový lifecycle;
- navigace nebo změna režimu nesmí resetovat controller.

### B. Více klientů na jedné brain session

Web a CLI mohou být připojené současně, proto server musí odlišit:

- `detachClient` — odpojí pouze konkrétní SSE/TUI transport;
- `abortConversation` — explicitně zastaví sdílený modelový turn.

Ukončení jednoho CLI klienta nesmí automaticky abortovat turn, který stále sleduje web. Změna modelu musí buď atomicky převést listeners/taps na nový live session objekt, nebo všem klientům poslat autoritativní reconnect/rebind event. Klienti se poté připojí ke stejné session a nové generaci.

### C. Model picker

- Použít existující `/brain/models` a `/brain/model`; nevytvářet druhý katalog.
- Picker seskupí modely podle provideru, ukáže provider/OAuth badge, aktivní model a případně podporované reasoning volby.
- Změna modelu se aplikuje na explicitně bound konverzaci a aktualizuje všechny připojené klienty bez ztráty historie.
- Dock může použít kompaktní variantu stejného pickeru.
- Elowen CLI se spouští až po úspěšném potvrzení modelu aktivní webové session, takže web i TUI zobrazují stejný model.

### D. Brain terminal service

Přidat úzkou službu, například `BrainTerminalService`, oddělenou od `AdvisorService` a `SpawnService`:

- `AdvisorService` zůstává vlastníkem externích Claude/Codex/OpenCode advisorů.
- `SpawnService` zůstává vlastníkem task workerů; Elowen chat TUI není worker.
- `BrainTerminalService` pouze spravuje adminovy interaktivní CLI klienty připojené k existujícím brain sessions.

Navržený kontrakt:

```http
POST /brain/terminal
{ "session": "<brainSessionId>" }
→ 201 { "terminal": "elowen-chat-…", "created": true|false }
```

Running stav se odvodí z existující vlastnicky filtrované `/sessions` query; samostatný polling endpoint nevznikne bez konkrétní potřeby.

Služba při startu:

1. ověří full-scope token a `user.is_admin === true`; agent token i běžný full-scope user jsou zakázaní;
2. ověří, že brain session patří právě tomuto adminovi a je continuable;
3. vytvoří nebo načte durable vazbu `terminal_name → user_id, brain_session_id, token_id`;
4. při existující tmux relaci vrátí její jméno;
5. vytvoří samostatný token pro konkrétní terminal instance;
6. spustí v neutrálním per-admin cwd příkaz ekvivalentní:

```sh
exec env ELOWEN_URL=<daemon> ELOWEN_TOKEN=<token> <elowen-cli> chat --session <id>
```

Tmux driver dostane argv/env launch variantu a spustí CLI přímo přes `tmux new-session`; příkaz ani token se nebudou zapisovat pomocí `send-keys`. Token se nesmí objevit v API odpovědi, logu ani názvu tmux relace.

Hosted TUI zachová běžné CLI schopnosti včetně lokálního shell escape. To je přijatelné pouze proto, že přístup je omezený na důvěryhodné administrátory hostitele; nejde o bezpečný shell pro běžné multi-tenant uživatele.

### E. Session identita, RBAC a lifecycle

- Rozšířit `SessionRole` o `chat`; `classifySession` rozpozná roli, durable metadata služba doplní `brainSessionId` a `userId`.
- Nepoužívat nereverzibilní hash bez metadata: tmux relace mohou přežít restart daemonu.
- Chat terminál smí vypsat, připojit, ovládat a ukončit pouze admin, který jej vytvořil. Obecný admin bypass se na roli `chat` nepoužije.
- Jiný admin dostane `403`; non-admin dostane `403` ještě před ownership kontrolou.
- Přidat oddělený uložený token scope/metadata pro chat terminal. Token má práva svého admina, ale je oddělený od login, advisor a agent tokenů a revokuje se s konkrétní relací.
- Role `chat` musí být explicitně zapojená do API middleware, `sessionAccessible`, session DELETE lifecycle, liveness sweepu a webových typů. Malformed chat identity je nepřístupná všem.
- Ukončení `elowen chat` ukončí tmux session a revokuje navázaný token. Explicitní Stop provede stejný cleanup.
- Smazání brain konverzace nejprve ukončí terminál a revokuje token, potom smaže session. Selhání cleanupu ponechá durable orphan záznam pro janitor.
- Startup/periodický janitor odstraní malformed nebo orphan chat terminal sessions a jejich tokeny.

### F. Navigace a shell

- Přidat `web/modules/chat/meta.ts`, `web/modules/chat/ChatView.tsx` a `web/app/chat/page.tsx`.
- Rozšířit `MODULES`, `NavigationWorldId`, `NAVIGATION_WORLDS`, `SPATIAL_ROUTE_ORDER` a registry testy.
- Přidat české i anglické `nav.chat`, `page.chat`, hinty, aria texty a prázdné/error stavy.
- Na route `/chat` launcher chatu neotevře duplicitní dock; adminovo tlačítko Terminál otevře stávající dock rovnou v terminálovém režimu.
- Chromeless výjimka v `ShellBody` zůstane pouze pro `/terminal/*`; chat fullscreen řeší stabilní portálový host, ne nová route.

## Implementační fáze

### 0. Bezpečnostní a víceklientský kontrakt

- Potvrdit admin-only boundary v UI, API middleware a session ownership.
- Specifikovat explicitní web session binding, `detachClient` versus `abortConversation` a model-switch rebind.
- Navrhnout durable terminal metadata, token per terminal a restart/expiry cleanup.
- Přidat cílené failing testy pro web + CLI na jedné session a non-admin/admin ownership.

### 1. Session-bound web controller bez UX změny

- Rozšířit typed `elowenClient` o session/client/generation kontrakty.
- Vyjmout síťový a stavový lifecycle do controlleru/provideru v `ShellLayout`.
- Zachovat všechny dnešní eventy: text, reasoning, tools/progress, subagents, cards, queue, asks, compaction, diff, usage a reconnect.
- Převést současný dock na `BrainChatSurface variant="compact"`.
- Ověřit draft, attachments, reconnect a jediný SSE stream při přepnutí Chat/Terminál.

### 2. Stránka `/chat`

- Přidat route, navigation meta, registry kontrakty a i18n.
- Implementovat historii vlevo, mobilní drawer, hlavní header, transcript a composer.
- Přesunout session search/list/delete z popupu do sdíleného `ChatHistoryRail`; kompaktní dock může dál používat dropdown variantu stejného datového zdroje.
- Doplnit přejmenování a export přes existující brain session API.

### 3. Model picker a víceklientský restart

- Nejdřív opravit serverový model-switch lifecycle a reconnect/rebind všech klientů.
- Vytvořit sdílený brain model picker nad `/brain/models` a session-bound `/brain/model`.
- Umístit jej do hlavního chat headeru a kompaktní variantu do docku.
- Ošetřit loading, žádný povolený model, provider error a změnu modelu během nečinné i aktivní konverzace.

### 4. Admin-only `BrainTerminalService`

- Implementovat argv-native launch, durable metadata, token lifecycle a idempotentní start.
- Rozšířit klasifikaci a owner-only guard session routes o roli `chat` bez obecného admin bypassu.
- Zapojit middleware, liveness sweep, DELETE cleanup, daemon bootstrap a janitor.
- Backend ověřit samostatně před přidáním frontendového tlačítka.

### 5. Elowen CLI v terminálovém výběru

- Pouze adminům rozdělit picker na **Elowen CLI** a **CLI agenti**.
- V Elowen sekci zobrazit aktivní brain model a akci pro otevření aktuální session.
- Po startu refreshnout sessions query, přidat vrácenou tmux session do dock state a otevřít `StreamTerminal`.
- Doplnit running/reconnect, detach, explicitní stop a pop-out; žádný token ani brain session ID neparsovat na klientu.
- Non-adminovi nevyrenderovat žádný Elowen CLI control.

### 6. Fullscreen, responsive a dokončení

- Přidat stabilní fullscreen host, Escape/focus management, `inert`, scroll lock a obnovu scrollu/selection.
- Ověřit desktop, úzký dock, mobil, změnu orientace, virtuální klávesnici a dlouhé tool výstupy.
- Aktualizovat `docs/WEB.md` a případně screenshoty až po stabilizaci UI.

## Testovací plán

### Backend

- `BrainTerminalService`: admin guard, bezpečný argv launch, idempotence, jedna relace na admin+brain session, ukončení a orphan cleanup.
- API: non-admin `403`, agent token `403`, cizí session, jiný admin `403`, neexistující session, tmux failure a správné status kódy.
- Session routes: role `chat` je viditelná a ovladatelná pouze adminem-vlastníkem; obecný admin bypass ji nezpřístupní jinému adminovi.
- Tokeny: token per terminal má práva admina-vlastníka, je oddělený od login/advisor/agent tokenů, nikdy se nevrací klientu a při cleanupu se revokuje.
- Delete conversation ukončí navázaný terminál nebo ponechá evidovaný orphan pro janitor.
- Web + CLI: detach jednoho klienta neabortuje turn; model switch rebindne oba klienty ke stejné session.

### Frontend unit/integration

- `/chat` je v obou navigacích a správně aktivní.
- History rail: přepnutí, nový chat, search, rename, export, delete a mobilní drawer.
- Model picker: katalog, allow-list, aktivní hodnota, úspěch/chyba a refresh session.
- Fullscreen: otevření/zavření, Escape, focus restore, zachování draftu/příloh/scrollu a žádný remount controlleru.
- Jeden controller: dock, `/chat` a fullscreen nevytvoří duplicitní SSE připojení.
- Admin terminal picker: Elowen sekce je nad CLI agenty, start přidá pane, opakovaný start neduplikuje pane, stop a pop-out fungují.
- Non-admin terminal picker: Elowen sekce ani startovací akce nejsou v DOM.

### Reálná cesta

1. Jako admin otevřít `/chat`, založit konverzaci a poslat zprávu.
2. Během streamu přejít do fullscreen a zpět; odpověď i draft zůstanou.
3. Změnit model a ověřit model ve statusline i session historii.
4. Kliknout Terminal → Elowen CLI a ověřit, že TUI otevře stejnou historii/session ID.
5. Poslat zprávu z TUI a vidět ji ve webu; poslat další z webu a vidět ji v TUI.
6. Odpojit a znovu připojit pane bez nové tmux relace; pak Stop a ověřit ukončení i revokaci tokenu.
7. Jako non-admin ověřit absenci CLI ovládání a `403` při ručním API volání.
8. Jako druhý admin ověřit, že cizí chat terminal nelze vypsat ani ovládat.

Po focused testech spustit:

```bash
# cílené root Vitest testy
npm test -- --run <root-test-files>

# cílené web Vitest testy
npm --prefix web test -- --run <web-test-files>

npm run lint
npm run typecheck
npm run build:web
npm run test:cli-tmux:built
```

## Akceptační kritéria

- Levá navigace obsahuje Chat a `/chat` funguje na desktopu i mobilu pro oprávněné uživatele.
- Chat má trvale viditelný, RBAC-filtered model picker a historii vlevo.
- Dock a stránka používají stejné chování, historii, draft a explicitně bound session.
- Fullscreen nezpůsobí reconnect, ztrátu draftu, remount controlleru ani druhý modelový turn.
- Pouze adminův terminálový výběr zobrazuje Elowen CLI odděleně nad CLI agenty.
- Non-admin nemůže Elowen CLI vypsat, spustit ani ovládat přes UI nebo API.
- Elowen CLI otevře aktuální webovou konverzaci, nikoli novou, a opakované otevření je idempotentní.
- Web a TUI mohou pokračovat ve stejné session oběma směry; odpojení jednoho klienta neabortuje druhého.
- Jiný admin nemůže vypsat, připojit, ovládat ani získat token cizího chat terminálu.
- Ukončené nebo osiřelé chat terminály ani jejich tokeny nezůstávají běžet.
- Focused root/web testy, lint, typecheck, web build a tmux smoke projdou.

## Mimo rozsah

- Nový chat protokol nebo nový brain backend.
- Paralelní kopie transcriptu pouze pro `/chat`.
- Browser Fullscreen API nebo pop-out webového chatu.
- Zpřístupnění tmuxu nebo Elowen CLI běžným uživatelům.
- Změna vzhledu externích CLI TUI.
- Sloučení legacy externího `AdvisorService` s embedded brainem.
- Automatické spuštění Elowen CLI při otevření terminálového tabu.
