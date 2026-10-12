# ONCE 안드로이드 앱 (TWA)

웹앱(https://alekf9099.github.io/life/)을 Google의 **Trusted Web Activity**로 감싼 안드로이드 프로젝트입니다.
[Bubblewrap](https://github.com/GoogleChromeLabs/bubblewrap)으로 생성했고, 설정은 `twa-manifest.json`에 있습니다.

| 항목 | 값 |
|---|---|
| 패키지 이름 | `io.github.alekf9099.once` |
| 버전 | 1.0.0 (versionCode 1) |
| 최소 / 대상 SDK | 21 (Android 5.0) / 35 |
| 시작 주소 | https://alekf9099.github.io/life/ |

## 1. 업로드 키 만들기 (한 번만)

플레이스토어에 올릴 파일에 서명하는 **업로드 키**입니다. 잃어버리면 업데이트가 어려우니 안전한 곳에 보관하세요. 절대 저장소에 커밋하지 마세요.

```bash
keytool -genkeypair -keystore once-upload.keystore -alias once \
  -keyalg RSA -keysize 2048 -validity 10000
```

## 2. GitHub에서 자동 빌드

저장소 **Settings → Secrets and variables → Actions**에 아래 4개를 등록합니다.

| 이름 | 값 |
|---|---|
| `ANDROID_KEYSTORE_BASE64` | `base64 -w0 once-upload.keystore` 결과 |
| `ANDROID_KEYSTORE_PASSWORD` | 키스토어 비밀번호 |
| `ANDROID_KEY_ALIAS` | `once` |
| `ANDROID_KEY_PASSWORD` | 키 비밀번호 |

그다음 **Actions → Android (TWA) build → Run workflow**를 누르거나 `v1.0.0` 같은 태그를 푸시하면,
빌드 결과(`ONCE.aab`, `ONCE.apk`)가 Artifacts로 올라옵니다. Secrets가 없으면 서명하지 않은 파일이 만들어집니다.

## 3. 로컬에서 빌드

```bash
cd android
./gradlew bundleRelease   # app/build/outputs/bundle/release/app-release.aab
```
JDK 17 이상과 Android SDK(platform 36, build-tools 36)가 필요합니다.

## 4. 주소창 없애기 (Digital Asset Links)

TWA는 웹사이트와 앱이 같은 주인임을 확인해야 주소창 없이 전체 화면으로 열립니다.
확인 파일은 **도메인 최상위**에 있어야 합니다: `https://alekf9099.github.io/.well-known/assetlinks.json`

- 이 주소는 `life` 저장소가 아니라 **`alekf9099.github.io` 저장소**(GitHub 사용자 사이트)에서 제공됩니다.
- 그 저장소를 만들고 `.well-known/assetlinks.json`에 [assetlinks.json](assetlinks.json) 내용을 넣으세요.
  - `.well-known` 폴더가 보이도록 저장소 루트에 빈 `.nojekyll` 파일도 함께 두세요.
- `REPLACE_WITH_PLAY_APP_SIGNING_SHA256` 자리에는 Play Console → **설정 → 앱 서명**에 나오는 **앱 서명 키 인증서 SHA-256**을 넣습니다.
  업로드 키 지문도 함께 넣어 두면 직접 설치한 APK에서도 주소창이 사라집니다.
- 자체 도메인을 연결하면 그 도메인의 `/.well-known/`에 두면 됩니다.

파일이 없어도 앱은 동작하지만, 화면 위에 작은 주소창이 보입니다.
