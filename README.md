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
  chat (trượt đi giống vuốt trong chat) → về màn hình chính (Zalo Web không ghi lịch sử khi mở
  chat nên phải tự xử lý).
- Mở app mượt: màn chờ có icon cho tới khi Zalo vẽ xong giao diện; không có hiệu ứng kéo quá
  đà ở cuối danh sách; giữ tay không bôi đen chữ/hiện thanh Sao chép (giữ tay lên tin nhắn
  vẫn mở menu tin nhắn của Zalo; ô nhập tin vẫn chọn chữ được).
- Mở cuộc chat không tự bật bàn phím: chỉ bật khi bạn chạm vào ô nhập tin.
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
- **Giao diện điện thoại** (mặc định bật) chèn `assets/zalo-mobile.css` để trông như app Zalo
  trên điện thoại:
  - thanh icon dọc bên trái thành **thanh tab dưới** (Tin nhắn, Danh bạ, Tài liệu, Cài đặt;
    bỏ Zalo Cloud và Công cụ/zBusiness); tự ẩn khi đang mở cuộc chat;
  - **header xanh** cho danh sách chat, khung chat và các trang Danh bạ; thanh trạng thái
    Android cũng tô xanh (biểu tượng trắng);
  - **khung soạn tin một hàng**: `⋯` · ảnh · ô nhập · biểu cảm · gửi. Bấm `⋯` để hiện lại đủ
    9 công cụ (sticker, file, danh thiếp, định dạng…);
  - **vuốt trong cuộc chat**: vuốt sang phải ở bất kỳ đâu (tin nhắn, nền, header) thì trang chat
    trượt theo ngón tay, danh sách chat hiện bên dưới như app iOS; thả tay khi đã kéo quá ~1/3
    màn hình (hoặc hất nhanh) thì đóng chat, chưa đủ thì trượt về. Cử chỉ Back từ mép màn hình
    (hoặc nút Back) đóng chat bằng đúng hiệu ứng trượt đó, chỉ là không theo tay vì HyperOS giữ
    mép màn hình cho cử chỉ của nó và chỉ báo Back khi đã thả tay. Vuốt một tin nhắn sang trái để
    trả lời tin đó (mở luôn bàn phím; máy rung nhẹ khi đã kéo đủ xa). Cuộn lên xuống vẫn như cũ;
  - **bàn phím trượt cùng cuộc chat**: khi bàn phím mở/đóng, tin nhắn và ô soạn tin trượt theo nó
    (cùng đường cong và thời lượng của bàn phím) thay vì nhảy một phát;
  - ẩn quảng cáo và lời nhắc: banner "Sử dụng Zalo PC", banner zBusiness lúc mở app, gợi ý
    "Đồng bộ tin nhắn gần đây?" (đồng bộ vẫn có ở Cài đặt → Dữ liệu → Đồng bộ tin nhắn) và thẻ
    nâng cấp zCloud trong thông tin My Documents.

  File này phụ thuộc tên class của Zalo; nếu Zalo cập nhật làm vỡ giao diện, tắt nó trong menu.

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

Alias của key là `zaloweb`. Thiếu secret thì workflow dừng với lỗi thay vì phát hành một APK
ký bằng debug key (bản đó không cài đè được lên app đang dùng).

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
