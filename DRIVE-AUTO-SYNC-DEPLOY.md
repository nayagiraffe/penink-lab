# Google Drive 자동 동기화 배포

앱 코드는 첫 연결 이후 앱을 열 때 세션을 복원하고, 연결된 계정의 Drive 데이터를 자동 동기화하도록 준비되어 있습니다. Google OAuth 비밀값과 암호화 키는 코드에 포함하지 않습니다.

## 배포 환경

Google 로그인 세션 쿠키와 `/api/google/*` 기능을 같은 출처에서 제공해야 합니다. GitHub Pages의 정적 주소만으로는 이 인증 API를 실행할 수 없습니다. 이 저장소의 `functions/`와 D1 설정을 함께 배포할 수 있는 Cloudflare Pages를 사용하고, 필요하면 기존 주소 대신 Pages 주소에 사용자 지정 도메인을 연결합니다.

## 최초 설정

1. Cloudflare Pages에 GitHub 저장소를 연결하고 배포 브랜치를 선택합니다.
2. 빌드 명령은 `npm run build:pages`, 빌드 출력 디렉터리는 `dist`로 지정합니다. Node.js 빌드 환경에서 실행합니다.
3. `wrangler.jsonc.example`을 `wrangler.jsonc`로 복사하고 D1 데이터베이스를 만듭니다. 생성된 데이터베이스 ID를 설정 파일의 `database_id`에 넣습니다.
4. D1에 `migrations/0001_google_drive_sessions.sql`을 적용합니다. Wrangler를 쓸 경우 `npx wrangler d1 migrations apply pen-ink-lab-auth --remote`를 실행합니다.
5. Cloudflare Pages의 D1 바인딩 이름을 `AUTH_DB`로 지정합니다. `wrangler.jsonc`의 바인딩도 같은 이름이어야 합니다.
6. Google Cloud Console에서 웹 애플리케이션 OAuth 클라이언트를 만들고, 배포 주소를 승인된 JavaScript 출처로 등록합니다. 승인된 리디렉션 URI는 `https://배포주소/api/google/callback`입니다. 앱은 `openid`와 `drive.appdata` 권한만 요청합니다.
7. Pages 환경 변수/비밀값을 설정합니다.

   - `APP_ORIGIN`: 끝에 `/`가 없는 실제 HTTPS 앱 주소
   - `GOOGLE_CLIENT_ID`: OAuth 웹 클라이언트 ID
   - `GOOGLE_CLIENT_SECRET`: OAuth 웹 클라이언트 비밀값 (Secret)
   - `TOKEN_ENCRYPTION_KEY`: 32바이트 무작위 키를 Base64로 인코딩한 값 (Secret)

암호화 키 예시 생성 명령은 `openssl rand -base64 32`입니다. 이 값을 소스 코드, 저장소, 공개 이슈에 넣지 말고 Cloudflare Secret에만 저장합니다. 키를 잃으면 기존 세션의 갱신 토큰을 복호화할 수 없어 모든 사용자가 Drive를 다시 연결해야 합니다.

Google OAuth 동의 화면이 테스트 모드라면 사용할 Google 계정을 테스트 사용자에 등록해야 합니다. 앱이 Google 검증을 요구하는 상태라면 공개 배포 전에 Google OAuth 검증 절차를 완료합니다.

## 배포 후 확인

- 앱의 백업·복원 화면에서 Drive 연결을 선택하고 Google 계정 권한을 승인합니다.
- 동일한 배포 주소를 다른 브라우저/기기에서도 열어 같은 계정으로 연결합니다.
- 한쪽에서 수정한 항목이 다른 쪽 앱을 열었을 때 동기화되는지 확인합니다.
- 개인정보 안내의 서버 보관 항목과 앱의 연결 해제 설명을 확인합니다.

연결 해제는 서버의 앱 로그인 세션을 삭제합니다. Google Drive에 이미 저장된 기록과 사진은 그대로 남고, Google 계정의 앱 권한 철회는 Google 계정 설정에서 별도로 할 수 있습니다.
