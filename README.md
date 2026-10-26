# Zalo Web (Android)

Ứng dụng Android cá nhân bọc trang **https://chat.zalo.me** trong một WebView, để dùng Zalo
trên điện thoại phụ song song với điện thoại chính (app Zalo chính thức sẽ đá phiên trên máy kia,
còn Zalo Web thì không).

- Chỉ bọc giao diện web chính thức — **không** dùng API Zalo không chính thức.
- Không phụ thuộc Google Play Services / Firebase / AndroidX; chạy tốt trên LineageOS không GMS.
- Kotlin, một Activity, `android.webkit` của framework. minSdk 29, targetSdk 35.

## Tải và cài

Mỗi lần push lên `main`, GitHub Actions build và tạo một
[Release](../../releases/latest) có file `ZaloWeb-0.1.<số build>.apk`.
Mở trang đó trên điện thoại, tải APK và cài (cho phép "cài ứng dụng không rõ nguồn gốc" cho trình duyệt).
Bản mới cài đè được bản cũ vì luôn ký cùng một keystore.

## Tính năng

- User-Agent Chrome desktop (Windows) — số phiên bản lấy từ WebView thật.
- Giữ đăng nhập (cookie, DOM storage, IndexedDB), flush cookie khi app vào nền.
- Gửi ảnh/file (chọn nhiều file), tải file về thư mục **Download**
  (kể cả file `blob:`/`data:` mà Zalo Web tạo rồi thu hồi ngay).
- Gọi thoại/video: xin quyền camera/micro khi Zalo yêu cầu (chỉ cấp cho domain Zalo).
- Nút Back như app: đóng popup/hộp thoại/trình xem ảnh → đóng khung thông tin → đóng cuộc
  chat → về màn hình chính (Zalo Web không ghi lịch sử khi mở chat nên phải tự xử lý).
- Mở app mượt: màn chờ có icon cho tới khi Zalo vẽ xong giao diện; không có hiệu ứng kéo quá
  đà ở cuối danh sách; giữ tay không bôi đen chữ/hiện thanh Sao chép (giữ tay lên tin nhắn
  vẫn mở menu tin nhắn của Zalo; ô nhập tin vẫn chọn chữ được).
- Link ngoài Zalo mở bằng trình duyệt; domain giữ lại trong app:
  `*.zalo.me`, `*.zaloapp.com`, `*.zadn.vn`, `*.zdn.vn`, `*.zalo.vn`.
- Nút nổi (kéo được) mở menu: tải lại, giao diện điện thoại, độ rộng hiển thị, cỡ chữ,
  CSS tùy chỉnh, đăng xuất/xóa dữ liệu.

## Giao diện trên điện thoại

Zalo Web tự chuyển sang chế độ **một khung** (danh sách chat ↔ khung chat, có nút quay lại)
khi trang hẹp hơn khoảng 850px. Vì vậy:

- **Độ rộng hiển thị → Tự động** (mặc định): giữ viewport `width=device-width` của Zalo,
  trang hiển thị đúng tỉ lệ 1:1 như app điện thoại. Chọn 480/600/800… nếu muốn thu nhỏ để
  thấy nhiều nội dung hơn.
- **Giao diện điện thoại** (mặc định bật) chèn `assets/zalo-mobile.css`: ẩn banner quảng cáo
  "Sử dụng Zalo PC" và ẩn thanh icon bên trái khi đang mở một cuộc chat để khung chat rộng hết
  màn hình. File này phụ thuộc tên class của Zalo; nếu Zalo cập nhật làm vỡ giao diện, tắt nó
  trong menu.

## Tinh chỉnh giao diện bằng CSS tùy chỉnh

1. Bật **Tùy chọn nhà phát triển → Gỡ lỗi USB** trên điện thoại, cắm cáp vào PC.
2. Mở Chrome trên PC, vào `chrome://inspect`, chọn trang `chat.zalo.me` → **inspect**.
3. Thử CSS trong DevTools, rồi dán vào **Nút nổi → CSS tùy chỉnh → Áp dụng**.
   CSS được chèn sau cùng; dùng `!important` nếu bị Zalo ghi đè.

## Ký APK bằng GitHub Secrets

Workflow lấy keystore từ 3 secret sau (Settings → Secrets and variables → Actions):

| Secret            | Nội dung                                  |
|-------------------|-------------------------------------------|
| `KEYSTORE_BASE64` | File keystore `.jks` mã hóa base64         |
| `KS_PASS`         | Mật khẩu keystore                          |
| `KEY_PASS`        | Mật khẩu key (PKCS12 thì giống `KS_PASS`)  |

Alias của key là `zaloweb`. Thiếu secret thì workflow vẫn build nhưng ký bằng debug key
(không cài đè được bản đã ký thật).

### Tự tạo keystore và thêm secret

```bash
keytool -genkeypair -v -storetype PKCS12 -keystore zaloweb-release.jks \
  -alias zaloweb -keyalg RSA -keysize 2048 -validity 10950 \
  -dname "CN=Zalo Web, O=Personal, C=VN"
```

Thêm secret bằng GitHub CLI:

```bash
base64 -w0 zaloweb-release.jks | gh secret set KEYSTORE_BASE64
gh secret set KS_PASS
gh secret set KEY_PASS
```

Hoặc trên web: repo → **Settings → Secrets and variables → Actions → New repository secret**,
dán nội dung base64 (lấy bằng `base64 -w0 zaloweb-release.jks`) và mật khẩu.

> **Sao lưu file keystore và mật khẩu ở nơi an toàn.** Mất keystore thì bản mới sẽ không cài
> đè được bản cũ — phải gỡ app (mất phiên đăng nhập) rồi cài lại.

## Giới hạn hiện tại

- Không có thông báo tin nhắn mới khi app tắt/chạy nền (WebView không hỗ trợ Web Notification API).
- Nếu Zalo vẫn hiện trang "tải app", có thể do `navigator.userAgentData` lộ là thiết bị di động.

## Build

```bash
gradle :app:assembleRelease
```

Cần JDK 17, Android SDK (platform 35) và Gradle 8.11.1. CI dùng `gradle/actions/setup-gradle`
nên repo không chứa Gradle wrapper.
