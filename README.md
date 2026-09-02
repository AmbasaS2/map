# 🗺️ Map

**Map is a SillyTavern extension that reads the current roleplay and organizes locations, character positions, quests, and discoveries on an interactive map.**

---

## 🧭 How to Use

**Choose a connection profile, theme, and output mode → open or generate the map → review locations, characters, and quests → apply them to the roleplay or save them to the notebook → explore, search, and track when needed → refresh or restore**

Settings and map state are saved whenever they change. Simply viewing information on the map does not add it to the roleplay. Only items for which you choose an apply mode are passed to subsequent responses.

---

## ⚙️ Extension Settings

The settings below follow the order shown in the Extensions panel.

### 🔌 Connection Profile

Choose the API used to generate map content.

- **Main API** — Uses the connection currently active in SillyTavern.
- **Separate connection profile** — Uses a profile saved in Connection Manager exclusively for Map.

### 🪄 Map Theme

| Theme | Description |
|---|---|
| **Marauder's Map (HP AU)** | A magical-map theme drawn in parchment, ink, and footprints. It also suits fantasy AUs and medieval settings. |
| **S.H.I.E.L.D. Field Locator (MCU AU)** | An MCU AU theme that displays locations and character position signals like an agency control terminal from the Winter Soldier era. |
| **Bonbon Board** | A miniature-board-game theme that places emoji location cards and named character pieces on a sweet-colored game board. |

The theme changes the screen colors, markers, and button names. Regardless of theme, the map uses the same structure and generates its contents from the world, era, and locations established by the current roleplay and character information.

### 📦 Output Mode

Choose how much content the map may generate.

| Mode | Full-map main-request limit | Target content |
|---|---:|---|
| **Basic** | Up to 8,000 tokens | 6–9 locations, 3–5 quests |
| **Saver** | Up to 4,000 tokens | 4–7 locations, 2–3 quests |

The map does not summarize only the single location mentioned in the latest message. One request lays out several locations together and coordinates where each character is, why they are there, what is happening at each location, and how the footsteps and quests connect. The relatively large output allowance helps reduce contradictions that can occur when locations and characters are generated separately.

Saver mode keeps the location-specific rules for characters and footsteps while reducing the number of locations and the amount of detail. The token numbers in the table are maximum output limits for the full-map main request, not target lengths or total limits for every request the feature may send. Actual usage varies with the roleplay length, number of characters, scene complexity, and model used.

A full-map request reads the 10 most recent messages. Both modes request a target of 6–10 footprints or position signals. Invalid results are excluded and a partially valid map is still saved, so the location, quest, and signal counts are target ranges rather than guaranteed minimums.

If the generated roster is too small or not distributed across enough locations, a separate footprint-completion request of up to 1,600 tokens may run. A separate optional review of location emojis may also use up to 600 tokens.

If a structured-output call through the Main API fails, the extension may retry it once with explicit JSON instructions under the same per-request limit.

### 🔤 Font Size

Adjust map text from 10 to 24 px. The default is 13 px, and all three themes use the same font-size scale.

Bonbon Board inherits the font of the current SillyTavern theme. Marauder's Map and S.H.I.E.L.D. Field Locator use their own display fonts while still following the same size setting.

### 🧹 Shared Map Data Cleanup

Select **🧹 공용 지도 데이터 정리** to choose one character whose character-shared map data should be cleared. The selector lists characters with saved shared data, places the current character first, and also displays unmatched saved entries so that they can be removed deliberately.

Cleanup deletes only the selected character's shared data:

- notebook entries and roleplay-application settings
- saved footstep details
- tracked characters and their movement history
- collected and uncollected place recommendations
- person-search records

It does **not** delete any chat's current map, one-step previous map, saved selected-location or generation metadata, current discovery markers, or discovery history. Connection-profile, theme, output-mode, and font-size settings also remain unchanged. The current map can therefore remain visible after cleanup, but cleared notebook items, applied context, saved footstep details, tracking data, recommendations, and person-search history will no longer carry across that character's chats.

If the current character is selected, any in-progress map operation is cancelled and the cleared roleplay context is removed from the active extension prompt immediately.

If the same SillyTavern data is open on another device, close or refresh it before running cleanup.

### 🐞 Debug Log

When map generation or saving does not work correctly, view up to 40 of the most recent request records from the current page. The display also includes the settings, current map state, and search state, and it can be copied or cleared. Debug logs are not stored in browser storage and disappear on refresh.

---

## 🗺️ Opening the Map

Select **Map** in the Extensions menu, then use the activation button for the chosen theme.

- **Marauder's Map:** `I solemnly swear that I am up to no good.`
- **S.H.I.E.L.D. Field Locator:** `보안 인증 후 신호망 접속` (Connect After Security Authentication) for a new map, or `보안 인증 후 기록 복원` (Restore Record After Security Authentication) when a map is already saved
- **Bonbon Board:** `봉봉보드 시작하기` (Start Bonbon Board) for a new map, or `봉봉보드 이어하기` (Continue Bonbon Board) when a map is already saved

- If the current chat already has a saved map, the existing map opens again.
- If there is no saved map, the extension reads the recent roleplay and creates a new one.
- The current map and one-step previous map are saved per chat.

**Mischief Managed.** or `×` closes the map window. Closing only the window while generation is in progress does not stop the request; the finished result is saved to the same chat.

If you move to another chat or disable the extension, a late result from the previous chat is cancelled so that it cannot be saved into the current map.

---

## 📍 Map Screen

### Map Board

| Display | Function |
|---|---|
| **Location node** | Opens the location's current atmosphere, nearby characters, and quests. |
| **Current-location highlight** | Shows the actual current location of the two protagonists. It does not move when another location is selected. |
| **Selected-location highlight** | Shows the location currently opened by the user, separately from the actual current location. |
| **Number beside a location** | Shows how many quests can be checked at that location. |
| **👣 Footprint / position signal / character piece** | Opens the detected character's name and current status. |
| **Floating emoji** | Opens a person, animal, object, letter, door, package, or other item revealed through exploration. |
| **Upper-right `🪄` / `📡` / `🔑`** | Runs a separate request to explore things not yet shown on the current map. |
| **Handle below the board** | Drag up or down to resize the map board's height. |

On Bonbon Board, emoji cards representing locations are placed along the four-sided game path. Regular location cards always have a thin milk-chocolate border and grow slightly on hover without changing position. Selecting a card opens its location name and full details. Character pieces display the character's name and sit inside the path near their linked location, while emoji discoveries appear outside the path near that same location. The actual current location is highlighted in pistachio, and the location opened by the user is highlighted in fig.

The area, time, and scene summary appear above the map. **S.H.I.E.L.D. Field Locator (MCU AU)** also shows when the map was last checked.

### Top Buttons

| Button | Function |
|---|---|
| `🔄` | Reads the recent roleplay again and rebuilds the full map. The pre-refresh map is saved as the previous map. |
| `↩️` | Restores the map from immediately before the full-map or single-location refresh. The restore can be used only once. |
| `🔎` | Finds a character's location or searches for places suited to the current roleplay. |
| `📓` | Opens the notebook for managing applied or collected information and tracked characters. |
| `🧠` | Shows the current map and location, locations, quests, application states, discovery count, and saved and active applied-item counts. |

---

## 🏛️ Locations

Select a location node to open its details.

| Available information | Description |
|---|---|
| **Current situation** | Shows the atmosphere of the space and what is moving or happening there now. |
| **Nearby characters** | Shows the people or groups currently at this location. |
| **Quests** | Shows events that can be continued at this location and their expected rewards. |

The `🔄` on a location card **checks only the selected location again**. It does not rebuild the full map.

A location refresh uses a main request of up to 6,500 tokens regardless of output mode and requests 0–1 quest for that location. A separate optional review of the refreshed location's emoji may use up to 600 tokens.

Under `📓 반영` (Apply), you can apply the whole location together with its quest, or select only the quest you want.

---

## ✨ Quests

Rather than rewriting what the two protagonists are already doing as a quest, Map mainly proposes events unfolding at other locations at the same time.

- **Basic:** 3–4 independent quests at other locations + 0–1 external reaction caused by an earlier protagonist action
- **Saver:** 2 independent quests at other locations + 0–1 external reaction caused by an earlier protagonist action

If there is no confirmed external reaction directly related to the protagonists, that slot remains empty. Independent quests are already progressing according to the circumstances of supporting characters, groups, institutions, or regions even if the protagonists never visit. The protagonists may later hear about them or travel to the location and take part.

Each quest displays:

- the quest and its current situation
- the connected location
- situations and choices that may become available while it progresses
- concrete expected rewards usable in the roleplay, such as an object, key, equipment, access permission, promise, assistance, or information

Quests do not start automatically in the roleplay. A quest is passed to the next response only after you explicitly apply it.

---

## 👣 Character Position Signals

Select a footprint, position signal, or character piece on the map to check that character's current state.

| Available information | Example |
|---|---|
| **Basic information** | Name, gender, age, current location, and mood |
| **Relationship** | Relationship and closeness with the user, and the most recent encounter |
| **Current state** | What the character is currently doing and thinking |
| **Inventory** | Objects or clues currently carried |
| **Follow-up hooks** | Possible scenes that can continue through this character |

When a footprint without current saved details is opened, the extension uses up to 5,000 tokens to generate and save the character's current state. If the age evidence is ambiguous or conflicts with established information, one short supplemental check of up to 700 tokens may run.

Select `👁 이후 동선 추적` (Track Later Movement) to add the character to the notebook's tracking list. **지금 어디 있지?** (Where are they now?) in the tracking list uses up to 5,000 tokens to update the latest location and activity.

---

## 🪄 Application Modes

Locations, quests, characters, discoveries, and searched places are managed through the same set of actions.

| Button | Function |
|---|---|
| `🪄` | Applies the selected information as background context beginning with the next response. |
| `👤` | Applies it so that the character notices the information first. |
| `🧍` | Applies it so that the user notices the information first. |
| `📓` | Saves it only to the notebook without applying it to the roleplay. |
| `🗑️` | Removes only the application setting. The original item remains visible on the map. |

Only information with a selected application mode is provided to subsequent AI responses through SillyTavern's extension prompt. No sentence is automatically inserted into the input box.

---

## 🪄 Revelio / 📡 Nearby Scan / 🔑 Key Card

The button in the upper-right corner of the map board uses a separate AI request to find specific people, objects, messages, location changes, or signs of events in progress that are not yet shown on the current map.

| Map theme | Button and feature name | Generated content |
|---|---|---|
| **Marauder's Map (HP AU)** | `🪄` **Revelio** | Basic: 5–7 items, up to 5,000 tokens / Saver: 3–5 items, up to 2,500 tokens |
| **S.H.I.E.L.D. Field Locator (MCU AU)** | `📡` **주변 상황 탐색** (Nearby Scan) | Basic: 5–7 items, up to 5,000 tokens / Saver: 3–5 items, up to 2,500 tokens |
| **Bonbon Board** | `🔑` **열쇠 카드** (Key Card) | Basic: 5–7 items, up to 5,000 tokens / Saver: 3–5 items, up to 2,500 tokens |

The counts in the table are target ranges. Duplicate or incorrectly formatted results are excluded, so fewer items may actually appear.

Each result appears on the map as an emoji suited to the detected subject. Animals may use `🐾` or `🐈`, letters `✉️` or `💌`, people `👤`, doors `🚪`, and packages `📦`, so the type of discovery can be inferred from the marker itself.

Select a marker to view:

- the exact subject just discovered and its current state
- what will change soon if it is left alone
- 2–3 possible actions, such as checking, approaching, helping, stopping, or tracking it
- any related character

Apply only the discoveries you want, or collect them in the notebook, using the same actions as for locations and quests.

**현재 지도에서 숨기기** (Hide from Current Map) removes that marker only from the current map board. Information already collected in the notebook or applied to the roleplay remains intact.

Running the exploration again replaces existing markers that have not been collected. Discoveries already collected or applied remain in the notebook.

---

## 🔎 Character and Place Search

Select `🔎` to choose between the **인물 찾기** (Find Person) and **장소 찾기** (Find Place) tabs.

### Find Person

After you enter a name, the extension first checks footprints and position signals saved in the current map, as well as the character lists for each location. A saved footprint profile is reused only while it still matches the current map signal; after the map changes, an outdated profile is generated again. If the character appears only by name in a location's character list, the extension keeps that location and performs one detailed check of the character's current activity, possessions, and clues.

For a character who is not on the map, the extension separately searches for a location and activity based on the current roleplay's setting, point in time, role, and movement.

- **Basic mode:** up to 2,500 tokens
- **Saver mode:** up to 1,500 tokens

If the evidence for the character's age is ambiguous or conflicts with established information, one short supplemental check of up to 700 tokens may run.

Person-search records are automatically saved to the notebook. `지도에 표시` (Show on Map) saves the result as a position signal with character details. Selecting that marker later does not send another AI request while the saved details still match the current signal. `👁 이후 동선 추적` (Track Later Movement) is used to check the character's new location and route after the roleplay has progressed.

Previous person-search records can be reopened or deleted from the notebook. Deleting a search record does not remove a character who is already being tracked or whose information was separately applied or collected.

If the specific searched location does not exist on the map when `지도에 표시` is selected, a location node for the search result is added and the character signal is placed there. If the map already contains 12 locations and cannot accept another node, the extension reports that it cannot add the location instead of attaching the character to an incorrect one.

Age and school year are not inferred from a name alone. The extension uses explicit information from the roleplay and character card together with the current world's date or era, school year, title, role, and established character chronology.

### Find Place

Searches for places that suit the setting and scene of the current roleplay.

Place search uses up to 5,000 tokens and requests at least three candidates.

Use quick search to choose **restaurants, date spots, current hotspots, or walking routes**, or enter your own conditions.

Results may include:

- place name and location
- a short introduction and mini review
- why it is famous and its signature feature
- possible scenarios and scenes

A place you like can be applied immediately or collected in the `📓` notebook. Selecting `🗑️` deletes that search result together with its connected collection and application setting.

---

## 👁 Character Tracking

Select `👁 이후 동선 추적` (Track Later Movement) in character details to check that character's later location and movement again from the notebook.

| Feature | Description |
|---|---|
| **지금 어디 있지?** (Where are they now?) | Reads the current roleplay again and updates the character's location and activity. |
| **이전 동선** (Previous Route) | Expands the previously checked location and activity history. |
| **Apply button** | Applies the character's latest route and current state to the next response. |
| **Stop tracking** | Removes the character from the tracking list. |

---

## 📓 Notebook Management

The notebook manages the following information in one place:

- applied or collected locations and quests
- discoveries collected through exploration
- applied or collected character information
- tracked characters and their previous routes
- person-search records
- collected place-search results

Items saved in the notebook can later have their application mode changed or be deleted.

Unique collected or applied items are not automatically deleted because of a count limit. Saving the same source item again updates it with the latest content.

Up to 24 uncollected place-search results are retained, and the 30 most recent discovery records are used for duplicate checking. These temporary-record limits are separate from the retention of unique items that the user explicitly collects or applies.

---

## 🧠 Stored Information

| Category | Storage scope |
|---|---|
| **Current map and one-step previous map** | Saved only in the current chat. They are never mixed with maps from other chats. |
| **Notebook and tracking information** | Saved in a notebook shared by the same character and available across that character's chats. |
| **Map Memory `🧠`** | Summarizes the current map and location, generation time, locations, quests, application states, discovery count, and saved and active applied-item counts. |

Map does not store map data or debug logs in `localStorage` or `IndexedDB`.

Refreshing the full map or a single location saves the immediately preceding state as the `↩️` previous map. Only one previous map is retained in the current chat. Restoring it consumes that snapshot so that the same two maps cannot be toggled back and forth repeatedly.

---

## 🤖 Features That Send AI Requests

| Feature | Processing |
|---|---|
| **Open a saved map or location** | Displays the saved information as-is. |
| **Create a new map or refresh the full map `🔄`** | Reads the recent roleplay and creates locations, character position signals, and quests again. |
| **Refresh one location `🔄`** | Checks that location's situation, nearby characters, and quest again. |
| **Find a person already on the current map `🔎`** | Reuses a detailed profile that still matches the current signal. If the profile is missing or outdated, or only a name and basic location exist, generates the detailed state again. |
| **Find a person not on the map `🔎`** | Reads the current roleplay and separately searches for the character's location and activity. |
| **Find a place `🔎`** | Generates places suited to the entered conditions and current setting. |
| **Revelio `🪄`, Nearby Scan `📡`, or Key Card `🔑`** | Sends a separate request to generate concrete subjects and changes not yet shown on the map. |
| **Open a footprint or position signal without a current matching profile** | Generates and saves the detailed state from the name and basic location. It may run again after the map signal changes. |
| **Tracked character's ‘Where are they now?’** | Reads the recent roleplay and updates that character's location and activity. |
| **Change an apply, collect, or tracking setting** | Updates only the storage state and whether the information is passed to subsequent responses. |

---

## ⚠️ Notes

- Map content is generated from the current roleplay and character information. Information not directly established in the roleplay may be inferred or newly created by the AI.
- Closing the map window does not stop generation. Moving to another chat, disabling the extension, or leaving or refreshing the page cancels an in-progress map operation.
- While the full map or a location is being read, another refresh request cannot start at the same time.
- If the map is updated while a person search or footprint-detail request is in progress, a late result based on the older map is not saved to the current map.

---

# 🗺️ 지도

**지도는 현재 RP를 읽어 장소, 인물의 위치, 퀘스트와 발견을 지도 위에 정리해주는 실리태번 확장입니다.**

---

## 🧭 사용 순서

**연결 프로필·테마·출력 모드 설정 → 지도 열기·생성 → 장소·인물·퀘스트 확인 → 반영 또는 수첩 저장 → 필요할 때 탐색·검색·추적 → 새로고침·복원**

설정과 지도 상태는 변경할 때 저장됩니다. 지도에서 확인만 한 정보는 RP에 들어가지 않으며, 직접 반영 방식을 선택한 항목만 다음 답변에 전달됩니다.

---

## ⚙️ 확장 설정

아래 설명은 확장 관리에 표시되는 순서와 같습니다.

### 🔌 연결 프로필

지도 생성에 사용할 API를 선택합니다.

- **메인 API** — 현재 실리태번에서 사용 중인 연결을 그대로 사용합니다.
- **별도 연결 프로필** — 연결 관리자에 저장한 프로필을 지도 전용으로 사용합니다.

### 🪄 지도 테마

| 테마 | 설명 |
|---|---|
| **Marauder's Map (HP AU)** | 양피지와 잉크, 발자국으로 펼쳐지는 마법 지도 테마입니다. 판타지 AU나 중세 배경에도 잘 어울립니다. |
| **S.H.I.E.L.D. Field Locator (MCU AU)** | 윈터솔져 시기의 기관 관제 단말처럼 장소와 인물의 위치 신호를 확인하는 MCU AU 테마입니다. |
| **Bonbon Board** | 달콤한 색의 게임판에 이모지 장소 카드와 이름이 붙은 인물 말을 놓는 미니어처 보드게임 테마입니다. |

테마는 화면의 색·표식·버튼 이름을 바꿉니다. 어느 테마를 선택해도 지도 내용은 현재 RP와 캐릭터 정보의 세계·시대·장소를 기준으로 같은 구조에서 생성됩니다.

### 📦 출력 모드

지도 생성에 사용할 출력 분량을 선택합니다.

| 모드 | 전체 지도 본 요청 한도 | 목표 생성 분량 |
|---|---:|---|
| **기본** | 최대 8,000토큰 | 장소 6~9개, 퀘스트 3~5개 |
| **절약** | 최대 4,000토큰 | 장소 4~7개, 퀘스트 2~3개 |

지도는 마지막 메시지에 나온 장소 하나만 정리하지 않습니다. 여러 장소를 한 번에 펼치고, 각 인물이 어디에 왜 있는지, 각 장소에서 무슨 일이 벌어지는지, 발자국과 퀘스트가 서로 맞물리도록 한 요청에서 함께 구성합니다. 장소와 인물을 따로 만들 때 생기는 모순을 줄이기 위한 구조라 출력 한도가 큰 편입니다.

절약 모드는 장소별 인물과 발자국의 기준은 유지하고 장소 수와 세부 설명을 줄입니다. 표의 토큰 수는 목표 분량이나 기능 전체 요청의 총한도가 아니라 전체 지도 본 요청의 최대 출력 한도이며, 실제 사용량은 RP 길이·등장인물 수·장면 복잡도와 사용하는 모델에 따라 달라집니다.

전체 지도는 최근 메시지 10개를 읽으며, 두 모드 모두 발자국·위치 신호 6~10개를 목표로 요청합니다. 형식이 맞지 않는 결과는 제외하고 일부만 유효한 지도도 그대로 저장하므로 장소·퀘스트·위치 신호 개수는 보장되는 최소값이 아니라 목표 범위입니다.

생성된 인물 목록이 너무 적거나 충분한 장소에 분산되지 않았을 때는 최대 1,600토큰의 발자국 보충 요청이 별도로 실행될 수 있습니다. 장소 이모지 검수도 최대 600토큰의 별도 선택 요청으로 실행될 수 있습니다.

메인 API의 구조화 출력 호출이 실패하면 같은 요청별 한도에서 JSON 형식 지시를 붙여 한 번 다시 요청할 수 있습니다.

### 🔤 글씨 크기

지도 안의 글씨 크기를 10~24px 범위에서 조절하며 기본값은 13px입니다. 세 테마 모두 같은 글씨 크기 배율을 사용합니다.

Bonbon Board는 현재 실리태번 테마의 글꼴을 상속합니다. Marauder's Map과 S.H.I.E.L.D. Field Locator는 각 테마의 화면용 글꼴을 사용하되 같은 크기 설정을 따릅니다.

### 🧹 공용 지도 데이터 정리

**🧹 공용 지도 데이터 정리**를 누르면 캐릭터별 공용 지도 데이터가 저장된 목록에서 정리할 캐릭터 하나를 선택할 수 있습니다. 현재 캐릭터가 맨 위에 표시되고, 현재 캐릭터 목록과 연결되지 않는 저장 데이터도 `[미매칭 저장 데이터]`로 표시되어 직접 선택해 정리할 수 있습니다.

정리하면 선택한 캐릭터의 다음 공용 데이터만 삭제됩니다.

- 수첩 항목과 RP 반영 설정
- 저장된 발자국 상세 정보
- 추적 중인 인물과 이전 동선
- 수집 여부와 관계없는 장소 추천
- 인물 검색 기록

각 채팅의 현재 지도, 한 단계 직전 지도, 저장된 선택 장소와 생성 시각·리비전 등의 상태, 현재 발견 표식과 발견 기록은 **삭제되지 않습니다**. 연결 프로필·테마·출력 모드·글씨 크기 설정도 그대로 유지됩니다. 따라서 정리 후에도 현재 지도 자체는 남아 있을 수 있지만, 지운 수첩 항목·반영 정보·발자국 상세·추적 정보·장소 추천·인물 검색 기록은 해당 캐릭터의 다른 채팅으로 더 이상 이어지지 않습니다.

현재 캐릭터를 선택하면 진행 중인 지도 작업은 취소되고, 지워진 RP 반영 정보는 현재 확장 프롬프트에서도 즉시 빠집니다.

다른 기기에서 같은 실리태번 데이터를 열어 두었다면 해당 기기를 닫거나 새로고침한 뒤 정리해 주세요.

### 🐞 디버그 로그

지도 생성이나 저장이 제대로 되지 않을 때 현재 페이지에서 발생한 최근 요청 기록을 최대 40건까지 확인합니다. 로그에는 설정·현재 지도·검색 상태가 함께 표시되며 복사하거나 비울 수 있습니다. 브라우저 저장소에는 남지 않고 새로고침하면 사라집니다.

---

## 🗺️ 지도 열기

확장 메뉴의 **지도**를 누른 뒤 선택한 테마의 활성화 버튼을 누릅니다.

- **Marauder's Map:** `I solemnly swear that I am up to no good.`
- **S.H.I.E.L.D. Field Locator:** 새 지도는 `보안 인증 후 신호망 접속`, 저장된 지도가 있으면 `보안 인증 후 기록 복원`
- **Bonbon Board:** 새 지도는 `봉봉보드 시작하기`, 저장된 지도가 있으면 `봉봉보드 이어하기`

- 현재 채팅에 저장된 지도가 있으면 기존 지도를 다시 펼칩니다.
- 저장된 지도가 없으면 최근 RP를 읽어 새 지도를 만듭니다.
- 지도와 직전 지도는 채팅별로 저장됩니다.

**Mischief Managed.** 또는 `×`는 지도 창을 닫는 버튼입니다. 지도 생성 중 창만 닫으면 생성은 계속 진행되며, 완료된 결과는 같은 채팅에 저장됩니다.

채팅을 이동하거나 확장을 끄면 이전 채팅에서 늦게 도착한 결과가 현재 지도에 저장되지 않도록 취소 처리됩니다.

---

## 📍 지도 화면

### 지도판

| 표시 | 기능 |
|---|---|
| **장소 노드** | 장소의 현재 분위기, 주변 인물과 퀘스트를 엽니다. |
| **현재 위치 강조** | 주인공 두 사람의 실제 현재 위치입니다. 다른 장소를 눌러도 움직이지 않습니다. |
| **선택 장소 강조** | 사용자가 지금 열어 본 장소입니다. 실제 현재 위치와 별도로 표시됩니다. |
| **장소 옆 숫자** | 해당 장소에서 확인할 수 있는 퀘스트 수입니다. |
| **👣 발자국 / 위치 신호 / 인물 말** | 지도에 포착된 인물의 이름과 현재 상태를 확인합니다. |
| **떠 있는 이모지** | 탐색으로 새로 드러난 인물·동물·물건·편지·문·소포 등을 엽니다. |
| **오른쪽 위 `🪄` / `📡` / `🔑`** | 현재 지도에 아직 표시되지 않은 것을 별도 요청으로 탐색합니다. |
| **지도판 아래 핸들** | 위아래로 드래그해 지도판의 높이를 조절합니다. |

Bonbon Board에서는 네 면의 게임 경로 위에 장소를 나타내는 이모지 카드를 놓습니다. 일반 장소 카드에도 얇은 밀크초콜릿색 테두리가 항상 보이고, 마우스를 올리면 위치를 유지한 채 조금 커집니다. 카드를 누르면 장소 이름과 전체 정보가 열립니다. 인물 말에는 캐릭터 이름이 함께 표시되며 연결된 장소의 경로 안쪽에, 탐색으로 발견한 이모지는 같은 장소의 경로 바깥쪽에 놓입니다. 실제 현재 위치는 피스타치오색으로, 사용자가 열어 본 장소는 무화과색으로 강조합니다.

지도 위쪽에는 현재 구역, 시간대와 장면 요약이 표시됩니다. **S.H.I.E.L.D. Field Locator (MCU AU)**에서는 지도를 마지막으로 확인한 시각도 함께 표시됩니다.

### 상단 버튼

| 버튼 | 기능 |
|---|---|
| `🔄` | 최근 RP를 다시 읽어 전체 지도를 새로 만듭니다. 새로고침 전 지도는 직전 지도에 보관됩니다. |
| `↩️` | 전체 지도 또는 장소 하나를 새로고침하기 직전의 지도로 되돌아갑니다. 복원은 한 번만 사용할 수 있습니다. |
| `🔎` | 인물의 위치를 찾거나 현재 RP에 어울리는 장소를 검색합니다. |
| `📓` | 반영·수집한 정보와 추적 중인 인물을 관리하는 수첩을 엽니다. |
| `🧠` | 현재 지도와 현재 위치, 장소, 퀘스트, 반영 상태, 발견 개수, 저장된 반영 데이터와 활성 반영 항목 개수를 요약해서 봅니다. |

---

## 🏛️ 장소

장소 노드를 누르면 장소 정보가 열립니다.

| 확인할 수 있는 내용 | 설명 |
|---|---|
| **현재 상황** | 공간의 분위기와 지금 벌어지고 있는 움직임을 보여줍니다. |
| **주변 인물** | 현재 이 장소에 있는 인물이나 무리를 보여줍니다. |
| **퀘스트** | 이 장소에서 이어갈 수 있는 사건과 예상 보상을 보여줍니다. |

장소 카드의 `🔄`는 **선택한 장소만 다시 확인**합니다. 전체 지도를 새로 만드는 버튼이 아닙니다.

장소 새로고침은 출력 모드와 관계없이 최대 6,500토큰의 본 요청을 사용하며, 해당 장소의 퀘스트는 0~1개를 목표로 다시 확인합니다. 새로고침한 장소의 이모지를 검수하는 최대 600토큰의 별도 선택 요청이 추가될 수 있습니다.

`📓 반영`에서는 장소 전체와 퀘스트를 함께 반영하거나, 원하는 퀘스트만 따로 선택할 수 있습니다.

---

## ✨ 퀘스트

지도는 주인공 두 사람이 지금 하고 있는 일을 퀘스트로 다시 적는 대신, 같은 시각 다른 장소에서 진행 중인 사건을 중심으로 제안합니다.

- **기본:** 다른 장소의 독립 퀘스트 3~4개 + 주인공의 이전 행동에서 생긴 외부 반응 0~1개
- **절약:** 다른 장소의 독립 퀘스트 2개 + 주인공의 이전 행동에서 생긴 외부 반응 0~1개

주인공과 직접 관련된 외부 반응이 확인되지 않으면 해당 자리는 비워 둡니다. 독립 퀘스트는 주인공이 가지 않아도 조연·집단·기관·지역의 사정에 따라 이미 진행되고 있으며, 나중에 소식을 듣거나 현장에 가서 참여할 수 있는 사건입니다.

퀘스트에는 다음 내용이 표시됩니다.

- 퀘스트 내용과 현재 상황
- 퀘스트가 연결된 장소
- 진행하면서 확인할 수 있는 상황과 선택지
- 실제 RP에서 사용할 수 있는 물건, 열쇠, 장비, 출입 권한, 약속, 도움이나 정보 등의 구체적인 예상 보상

퀘스트는 자동으로 RP에 시작되지 않습니다. 원하는 퀘스트를 직접 반영했을 때만 다음 답변에 참고됩니다.

---

## 👣 인물 위치 신호

지도 위의 발자국, 위치 신호 또는 인물 말을 누르면 해당 인물의 현재 상태를 확인합니다.

| 확인할 수 있는 내용 | 예시 |
|---|---|
| **기본 정보** | 이름, 성별, 나이, 현재 위치와 기분 |
| **관계** | 유저와의 관계 및 친밀도, 최근 마주친 순간 |
| **현재 상태** | 지금 하고 있는 행동과 생각 |
| **인벤토리** | 현재 가지고 있는 물건이나 단서 |
| **따라갈 만한 단서** | 이 인물로 이어갈 수 있는 장면 후보 |

현재 지도 신호와 맞는 상세 정보가 없는 발자국을 확인할 때는 최대 5,000토큰을 사용해 현재 상태를 생성하고 저장합니다. 연령 근거가 모호하거나 확립된 설정과 충돌하면 최대 700토큰의 짧은 보조 확인을 한 번 추가할 수 있습니다.

`👁 이후 동선 추적`을 누르면 수첩의 추적 목록에 추가됩니다. 추적 목록의 **지금 어디 있지?**는 최대 5,000토큰을 사용해 최근 위치와 행동을 갱신합니다.

---

## 🪄 반영 방식

장소, 퀘스트, 인물, 발견과 검색 장소는 같은 방식으로 관리합니다.

| 버튼 | 기능 |
|---|---|
| `🪄` | 선택한 정보를 다음 답변부터 배경 정보로 반영합니다. |
| `👤` | 캐릭터가 해당 정보를 먼저 알아차리도록 반영합니다. |
| `🧍` | 유저가 해당 정보를 먼저 알아차리도록 반영합니다. |
| `📓` | RP에는 반영하지 않고 수첩에만 저장합니다. |
| `🗑️` | 반영 설정만 해제합니다. 지도에 표시된 원본 항목은 유지됩니다. |

반영을 선택한 정보만 실리태번의 확장 프롬프트를 통해 다음 AI 답변에 참고됩니다. 입력창에 문장이 자동으로 붙지는 않습니다.

---

## 🪄 Revelio / 📡 주변 상황 탐색 / 🔑 열쇠 카드

지도판 오른쪽 위의 버튼을 누르면 현재 지도에 아직 표시되지 않은 구체적인 존재·물건·메시지·장소의 변화·진행 중인 사건의 징후를 별도의 AI 요청으로 확인합니다.

| 지도 테마 | 버튼과 기능 이름 | 생성 분량 |
|---|---|---|
| **Marauder's Map (HP AU)** | `🪄` **Revelio** | 기본 5~7개·최대 5,000토큰 / 절약 3~5개·최대 2,500토큰 |
| **S.H.I.E.L.D. Field Locator (MCU AU)** | `📡` **주변 상황 탐색** | 기본 5~7개·최대 5,000토큰 / 절약 3~5개·최대 2,500토큰 |
| **Bonbon Board** | `🔑` **열쇠 카드** | 기본 5~7개·최대 5,000토큰 / 절약 3~5개·최대 2,500토큰 |

표의 개수는 목표 범위입니다. 중복되거나 형식이 맞지 않는 결과는 제외하므로 실제 표시 수는 더 적을 수 있습니다.

탐색 결과는 실제 대상에 맞는 이모지로 지도 위에 표시됩니다. 동물은 `🐾`·`🐈`, 편지는 `✉️`·`💌`, 인물은 `👤`, 문은 `🚪`, 소포는 `📦`처럼 이모지만 보고도 무엇을 발견했는지 짐작할 수 있게 생성됩니다.

표식을 누르면 아래 내용을 확인할 수 있습니다.

- 지금 발견한 정확한 대상과 상태
- 이대로 두면 곧 벌어질 변화
- 확인·접근·도움·중단·추적 등 해볼 수 있는 행동 2~3개
- 관련 인물이 있다면 그 인물

원하는 발견만 기존 장소·퀘스트와 같은 방식으로 반영하거나 수첩에만 수집할 수 있습니다.

발견 상세의 **현재 지도에서 숨기기**는 해당 표식을 현재 지도판에서만 치웁니다. 이미 수첩에 수집하거나 RP에 반영한 정보는 그대로 유지됩니다.

다시 탐색하면 아직 수집하지 않은 기존 표식은 새 결과로 교체됩니다. 이미 수집하거나 반영한 발견은 수첩에 남습니다.

---

## 🔎 인물·장소 검색

`🔎`를 누르면 **인물 찾기**와 **장소 찾기** 탭을 선택할 수 있습니다.

### 인물 찾기

이름을 입력하면 먼저 현재 지도에 저장된 발자국·위치 신호와 장소별 인물 목록을 확인합니다. 저장된 발자국 상세 정보는 현재 지도 신호와 여전히 일치할 때만 그대로 보여주며, 지도 갱신 뒤 낡아진 상세 정보는 다시 생성합니다. 장소별 인물 목록에 이름만 있는 경우에는 그 위치를 유지한 채 현재 행동과 소지품·단서를 한 번 자세히 확인합니다.

지도에 없는 인물은 현재 RP의 세계관·시점·역할·동선을 바탕으로 위치와 행동을 별도로 찾습니다.

- **기본 모드:** 최대 2,500토큰
- **절약 모드:** 최대 1,500토큰

연령 근거가 모호하거나 확립된 설정과 충돌하면 최대 700토큰의 짧은 보조 확인을 한 번 추가할 수 있습니다.

인물 검색 기록은 수첩에 자동으로 저장됩니다. `지도에 표시`는 검색 결과를 위치 신호와 인물 정보에 저장합니다. 저장된 상세 정보가 현재 위치 신호와 일치하는 동안에는 그 표식을 다시 눌러도 같은 정보를 만들기 위한 AI 요청을 한 번 더 보내지 않습니다. `👁 이후 동선 추적`은 이후 RP가 진행된 뒤 새 위치와 동선을 다시 확인할 때 사용합니다.

수첩에서 이전 인물 검색 기록을 다시 열거나 삭제할 수 있습니다. 검색 기록을 삭제해도 이미 추적 중이거나 별도로 반영·수집한 인물 정보는 유지됩니다.

`지도에 표시`를 눌렀을 때 검색된 구체 장소가 기존 지도에 없으면 검색 결과용 장소 노드를 추가하고 그 노드에 인물 신호를 놓습니다. 지도에 장소가 이미 12개 있어 새 노드를 추가할 수 없는 경우에는 다른 장소에 잘못 붙이지 않고 추가할 수 없다고 안내합니다.

나이와 학년은 이름만으로 정하지 않고, RP와 캐릭터 카드의 명시 정보, 현재 세계의 시점·연도, 학년·직함·역할과 확립된 인물의 연대기를 함께 사용합니다.

### 장소 찾기

현재 RP의 세계관과 장면에 어울리는 장소를 찾습니다.

장소 검색은 최대 5,000토큰을 사용하며 최소 3개의 후보를 요청합니다.

빠른 검색으로 **맛집, 데이트 명소, 요즘 핫플레이스, 산책 코스**를 고르거나 원하는 조건을 직접 입력할 수 있습니다.

검색 결과에는 다음 내용이 표시될 수 있습니다.

- 장소 이름과 위치
- 짧은 소개와 미니 리뷰
- 유명한 이유와 시그니처
- 예상 시나리오와 가능한 장면

마음에 드는 장소는 바로 반영하거나 `📓` 수첩에 수집할 수 있습니다. `🗑️`를 누르면 해당 검색 결과와 연결된 수집·반영 설정도 함께 삭제됩니다.

---

## 👁 인물 추적

인물 정보에서 `👁 이후 동선 추적`을 누르면 수첩에서 이후 위치와 동선을 다시 확인할 수 있습니다.

| 기능 | 설명 |
|---|---|
| **지금 어디 있지?** | 현재 RP를 다시 읽어 인물의 위치와 행동을 갱신합니다. |
| **이전 동선** | 이전에 확인한 위치와 행동 기록을 펼쳐봅니다. |
| **반영 버튼** | 인물의 최근 동선과 현재 상태를 다음 답변에 반영합니다. |
| **추적 해제** | 추적 목록에서 인물을 삭제합니다. |

---

## 📓 수첩 관리

수첩에서는 다음 정보를 한곳에서 관리합니다.

- 반영하거나 수집한 장소와 퀘스트
- 탐색으로 수집한 발견
- 반영하거나 수집한 인물 정보
- 추적 중인 인물과 이전 동선
- 인물 검색 기록
- 수집한 장소 검색 결과

수첩에 저장한 항목은 나중에 반영 방식을 바꾸거나 삭제할 수 있습니다.

수집하거나 반영한 고유 항목은 개수 제한 때문에 자동으로 삭제되지 않습니다. 같은 원본 항목을 다시 저장하면 최신 내용으로 갱신됩니다.

아직 수집하지 않은 장소 검색 결과는 최대 24개만 보관하고, 발견 중복 확인 기록은 최근 30개를 사용합니다. 이 임시 기록 한도는 사용자가 직접 수집하거나 반영한 고유 항목의 보존과 별개입니다.

---

## 🧠 저장되는 정보

| 구분 | 저장 범위 |
|---|---|
| **현재 지도와 직전 지도** | 현재 채팅에만 저장됩니다. 다른 채팅의 지도와 섞이지 않습니다. |
| **수첩과 추적 정보** | 같은 캐릭터의 공용 수첩에 저장되어 다른 채팅에서도 이어서 볼 수 있습니다. |
| **지도 메모리 `🧠`** | 현재 지도와 현재 위치, 생성 시각, 장소, 퀘스트, 반영 상태, 발견 개수, 저장된 반영 데이터와 활성 반영 항목 개수를 요약해서 보여줍니다. |

지도 확장은 `localStorage`나 `IndexedDB`에 지도 데이터나 디버그 로그를 저장하지 않습니다.

전체 지도나 장소 하나를 새로고침하면 바로 전 상태가 `↩️` 직전 지도에 저장됩니다. 직전 지도는 현재 채팅에 하나만 유지되며, 복원하면 해당 스냅샷이 사라져 같은 두 지도를 반복해서 왕복하지 않습니다.

---

## 🤖 AI 요청이 발생하는 기능

| 기능 | 처리 방식 |
|---|---|
| **저장된 지도·장소 열기** | 저장된 정보를 그대로 표시합니다. |
| **새 지도 생성·전체 지도 새로고침 `🔄`** | 최근 RP를 읽어 장소, 인물 위치 신호와 퀘스트를 새로 만듭니다. |
| **장소 새로고침 `🔄`** | 선택한 장소의 상황, 주변 인물과 퀘스트를 새로 확인합니다. |
| **현재 지도에 있는 인물 찾기 `🔎`** | 현재 위치 신호와 일치하는 상세 정보는 그대로 표시합니다. 상세 정보가 없거나 낡았거나 이름과 기본 위치만 있으면 상세 상태를 다시 생성합니다. |
| **지도에 없는 인물 찾기 `🔎`** | 현재 RP를 읽어 인물의 위치와 행동을 별도로 찾습니다. |
| **장소 찾기 `🔎`** | 입력한 조건과 현재 세계관에 맞는 장소를 생성합니다. |
| **Revelio `🪄`·주변 상황 탐색 `📡`·열쇠 카드 `🔑`** | 지도에 아직 표시되지 않은 구체적인 대상과 변화를 별도 요청으로 생성합니다. |
| **현재 신호와 맞는 상세 정보가 없는 발자국·위치 신호 확인** | 이름과 기본 위치를 바탕으로 상세 상태를 생성해 저장합니다. 지도 신호가 달라지면 다시 요청할 수 있습니다. |
| **추적 인물의 ‘지금 어디 있지?’** | 최근 RP를 읽어 해당 인물의 위치와 행동을 갱신합니다. |
| **반영·수집·추적 설정 변경** | 저장 방식과 다음 답변 반영 여부만 갱신합니다. |

---

## ⚠️ 참고사항

- 지도 내용은 현재 RP와 캐릭터 정보를 바탕으로 생성되며, RP에 직접 나오지 않은 내용은 AI가 추정하거나 새로 만들어 추가할 수 있습니다.
- 지도 창만 닫으면 생성은 계속됩니다. 다른 채팅으로 이동하거나 확장을 비활성화하거나 페이지를 나가거나 새로고침하면 진행 중인 지도 작업이 취소됩니다.
- 전체 지도 또는 장소 정보를 읽는 중에는 다른 새로고침 요청을 동시에 시작하지 않습니다.
- 인물 검색이나 발자국 상세 정보를 읽는 동안 지도가 갱신되면, 이전 지도 기준으로 늦게 도착한 결과는 현재 지도에 저장되지 않습니다.

---

## Copyright & License

Copyright © 2026 AmbasaS2  
Licensed under the GNU Affero General Public License v3.0.  
https://github.com/AmbasaS2

The full license text is provided in the `LICENSE` file.
