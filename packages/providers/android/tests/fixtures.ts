// Android APK fixture data (mocked aapt2/apktool/jadx/apksigner output)
export const aapt2PermissionsFixture = `permission: android.permission.INTERNET
permission: android.permission.ACCESS_NETWORK_STATE
permission: android.permission.CAMERA
permission: android.permission.WRITE_EXTERNAL_STORAGE
`;

export const apktoolOutputFixture = `
Parsing AndroidManifest.xml...
Parsing strings.xml...
Copying 123 files...
Copying 456 files...
Build complete.
`;

export const apksignerOutputFixture = `
Verifying...
Verified using v1 scheme (JAR signing): true
Verified using v2 scheme (APK Signature Scheme v2): true
Verified using v3 scheme (APK Signature Scheme v3): false
Verified using v4 scheme (APK Signature Scheme v4): false
Signers:
Signer #1:
    Type: V1
    ...
    Subject: CN=Android Debug, O=Android, C=US
    ...
`;

export const jadxOutputFixture = `
Loading classes...
Generating resources...
Exporting gradle project...
Done.
`;

export const minimalApkBytes = new Uint8Array([
  0x50, 0x4b, 0x03, 0x04, // ZIP local file header signature (APK is a ZIP)
  0x14, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
  0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
  0x00, 0x00, 0x00, 0x00,
  'AndroidManifest.xml'.length > 0 ? 'A'.charCodeAt(0) : 0,
]);

// Parsed AndroidManifest.xml fixture
export const androidManifestFixture = `<?xml version="1.0" encoding="utf-8"?>
<manifest xmlns:android="http://schemas.android.com/apk/res/android"
    package="com.example.testapp"
    android:versionCode="1"
    android:versionName="1.0">
    <uses-sdk android:minSdkVersion="21" android:targetSdkVersion="33" />
    <uses-permission android:name="android.permission.INTERNET" />
    <uses-permission android:name="android.permission.CAMERA" />
    <application android:label="@string/app_name">
        <activity android:name=".MainActivity">
            <intent-filter>
                <action android:name="android.intent.action.MAIN" />
                <category android:name="android.intent.category.LAUNCHER" />
            </intent-filter>
        </activity>
    </application>
</manifest>
`;
