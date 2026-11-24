# SDSMP 레이저런 (GitHub Pages + Firebase)

성덕 레이저런 리그의 기록 · 중계 사이트입니다. 화면은 GitHub Pages가 보여 주고, 기록은 Firebase(Firestore · Realtime Database)에 저장됩니다.

## 처음 한 번 설정
1. `fb/config.js`에 Firebase 웹 앱 설정값을 넣습니다 (공개돼도 되는 값).
2. Firebase 콘솔 › Firestore › **규칙**에 `firestore.rules` 내용을 붙여 넣고 게시합니다.
3. Firebase 콘솔 › Realtime Database › **규칙**에 `database.rules.json` 내용을 붙여 넣고 게시합니다.
4. Firebase 콘솔 › 보안 › Authentication › 설정 › **승인된 도메인**에 `<GitHub아이디>.github.io`를 추가합니다.
5. 사이트에서 대회를 맡은 선생님이 Google로 로그인 → 「이 대회의 관리자로 등록」을 누릅니다.
6. 왼쪽 아래 「계정 · 권한」에서 체육회 코드와 TV 코드를 정합니다.

## 역할
| 역할 | 들어가는 방법 | 할 수 있는 일 |
|---|---|---|
| 관리자 | Google 로그인(처음 한 명) | 모든 기록 · 설정, 코드 · 권한 관리 |
| 선생님 | Google 로그인 → 관리자 승인 | 기록 입력 · 수정, 경기 · 설정 |
| 체육회 · 지점 요원 | 이름 + 체육회 코드 | 모든 화면 보기 (지점 버튼은 다음 단계에서 추가) |
| TV 화면 | TV 코드 | 모든 화면 보기, TV 송출 |

학생 이름 · 기록은 저장소(GitHub)에 들어가지 않고 Firebase에만 저장되며, 역할이 있는 사람만 읽을 수 있습니다.
