/**
 * Generates benign sample binaries and APK fixtures for integration and performance testing.
 * These files are authorized test fixtures and are NEVER executed at runtime.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

const binariesDir = path.join(rootDir, 'tests', 'fixtures', 'sample-binaries');
const apksDir = path.join(rootDir, 'tests', 'fixtures', 'sample-apks');

fs.mkdirSync(binariesDir, { recursive: true });
fs.mkdirSync(apksDir, { recursive: true });

// ── 1. Benign ELF Binary (32-bit x86 Linux) ──────────────────────────────────
// Valid ELF32 header + 2 program headers + .text section + .rodata section
function buildBenignElf() {
  const elf = Buffer.alloc(512);

  // e_ident
  elf[0] = 0x7f;
  elf[1] = 0x45; // 'E'
  elf[2] = 0x4c; // 'L'
  elf[3] = 0x46; // 'F'
  elf[4] = 0x01; // ELFCLASS32
  elf[5] = 0x01; // ELFDATA2LSB (little endian)
  elf[6] = 0x01; // EV_CURRENT
  elf[7] = 0x00; // ELFOSABI_NONE / System V

  elf.writeUInt16LE(2, 16); // e_type: ET_EXEC (Executable)
  elf.writeUInt16LE(3, 18); // e_machine: EM_386 (Intel 80386)
  elf.writeUInt32LE(1, 20); // e_version: EV_CURRENT
  elf.writeUInt32LE(0x08048060, 24); // e_entry
  elf.writeUInt32LE(52, 28); // e_phoff: 52 (immediately following ELF header)
  elf.writeUInt32LE(180, 32); // e_shoff: section header table offset
  elf.writeUInt32LE(0, 36); // e_flags
  elf.writeUInt16LE(52, 40); // e_ehsize: 52 bytes
  elf.writeUInt16LE(32, 42); // e_phentsize: 32 bytes
  elf.writeUInt16LE(2, 44); // e_phnum: 2 program headers (PT_LOAD)
  elf.writeUInt16LE(40, 46); // e_shentsize: 40 bytes
  elf.writeUInt16LE(3, 48); // e_shnum: 3 section headers (NULL, .text, .rodata)
  elf.writeUInt16LE(0, 50); // e_shstrndx

  // Program Header 1: PT_LOAD for code (offset 52)
  let off = 52;
  elf.writeUInt32LE(1, off); // p_type: PT_LOAD
  elf.writeUInt32LE(0, off + 4); // p_offset
  elf.writeUInt32LE(0x08048000, off + 8); // p_vaddr
  elf.writeUInt32LE(0x08048000, off + 12); // p_paddr
  elf.writeUInt32LE(0x100, off + 16); // p_filesz
  elf.writeUInt32LE(0x100, off + 20); // p_memsz
  elf.writeUInt32LE(5, off + 24); // p_flags: PF_R | PF_X
  elf.writeUInt32LE(0x1000, off + 28); // p_align

  // Program Header 2: PT_LOAD for rodata (offset 84)
  off = 84;
  elf.writeUInt32LE(1, off); // p_type: PT_LOAD
  elf.writeUInt32LE(0x100, off + 4); // p_offset
  elf.writeUInt32LE(0x08049000, off + 8); // p_vaddr
  elf.writeUInt32LE(0x08049000, off + 12); // p_paddr
  elf.writeUInt32LE(0x40, off + 16); // p_filesz
  elf.writeUInt32LE(0x40, off + 20); // p_memsz
  elf.writeUInt32LE(4, off + 24); // p_flags: PF_R
  elf.writeUInt32LE(0x1000, off + 28); // p_align

  // Code bytes at entry point offset 0x60 (96 decimal)
  // Simple benign x86 instructions (xor eax, eax; ret)
  elf[96] = 0x31;
  elf[97] = 0xc0; // xor eax, eax
  elf[98] = 0xc3; // ret

  // String data at 0x100 (256)
  const str = Buffer.from('SRE_STUDIO_BENIGN_ELF_SAMPLE_v1.0\0', 'utf8');
  str.copy(elf, 256);

  return elf;
}

// ── 2. Benign PE Binary (32-bit Windows PE) ──────────────────────────────────
// Valid DOS MZ Header + PE Signature + COFF File Header + Optional Header + Section Headers
function buildBenignPe() {
  const pe = Buffer.alloc(1024);

  // DOS MZ Header
  pe[0] = 0x4d; // 'M'
  pe[1] = 0x5a; // 'Z'
  pe.writeUInt16LE(0x90, 2); // e_cblp
  pe.writeUInt16LE(3, 4); // e_cp
  pe.writeUInt16LE(0, 6); // e_crlc
  pe.writeUInt16LE(4, 8); // e_cparhdr
  pe.writeUInt16LE(0xffff, 10); // e_maxalloc
  pe.writeUInt16LE(0x40, 60); // e_lfanew = 0x40 (PE offset)

  // PE Signature at 0x40
  const peOffset = 0x40;
  pe.write('PE\0\0', peOffset, 'ascii');

  // COFF File Header (20 bytes at peOffset + 4)
  const coffOffset = peOffset + 4;
  pe.writeUInt16LE(0x014c, coffOffset); // Machine: IMAGE_FILE_MACHINE_I386
  pe.writeUInt16LE(2, coffOffset + 2); // NumberOfSections: 2 (.text, .rdata)
  pe.writeUInt32LE(1700000000, coffOffset + 4); // TimeDateStamp
  pe.writeUInt32LE(0, coffOffset + 8); // PointerToSymbolTable
  pe.writeUInt32LE(0, coffOffset + 12); // NumberOfSymbols
  pe.writeUInt16LE(224, coffOffset + 16); // SizeOfOptionalHeader (Standard 32-bit PE = 224)
  pe.writeUInt16LE(0x0102, coffOffset + 18); // Characteristics: EXECUTABLE_IMAGE | 32BIT_MACHINE

  // Optional Header (224 bytes at coffOffset + 20)
  const optOffset = coffOffset + 20;
  pe.writeUInt16LE(0x010b, optOffset); // Magic: PE32 (0x10b)
  pe[optOffset + 2] = 14; // MajorLinkerVersion
  pe[optOffset + 3] = 0; // MinorLinkerVersion
  pe.writeUInt32LE(0x200, optOffset + 4); // SizeOfCode
  pe.writeUInt32LE(0x200, optOffset + 8); // SizeOfInitializedData
  pe.writeUInt32LE(0, optOffset + 12); // SizeOfUninitializedData
  pe.writeUInt32LE(0x1000, optOffset + 16); // AddressOfEntryPoint
  pe.writeUInt32LE(0x1000, optOffset + 20); // BaseOfCode
  pe.writeUInt32LE(0x2000, optOffset + 24); // BaseOfData
  pe.writeUInt32LE(0x00400000, optOffset + 28); // ImageBase
  pe.writeUInt32LE(0x1000, optOffset + 32); // SectionAlignment
  pe.writeUInt32LE(0x200, optOffset + 36); // FileAlignment
  pe.writeUInt16LE(6, optOffset + 40); // MajorOSVersion
  pe.writeUInt16LE(0, optOffset + 42); // MinorOSVersion
  pe.writeUInt32LE(0x3000, optOffset + 56); // SizeOfImage
  pe.writeUInt32LE(0x200, optOffset + 60); // SizeOfHeaders
  pe.writeUInt16LE(3, optOffset + 68); // Subsystem: IMAGE_SUBSYSTEM_WINDOWS_CUI
  pe.writeUInt16LE(0x8140, optOffset + 70); // DllCharacteristics: DYNAMIC_BASE | NX_COMPAT | TERMINAL_SERVER_AWARE
  pe.writeUInt32LE(0x100000, optOffset + 72); // SizeOfStackReserve
  pe.writeUInt32LE(0x1000, optOffset + 76); // SizeOfStackCommit
  pe.writeUInt32LE(0x100000, optOffset + 80); // SizeOfHeapReserve
  pe.writeUInt32LE(0x1000, optOffset + 84); // SizeOfHeapCommit
  pe.writeUInt32LE(16, optOffset + 92); // NumberOfRvaAndSizes

  // Section Headers (40 bytes each, starting at optOffset + 224)
  const secOffset = optOffset + 224;

  // Section 1: .text
  pe.write('.text\0\0\0', secOffset, 'ascii');
  pe.writeUInt32LE(0x100, secOffset + 8); // VirtualSize
  pe.writeUInt32LE(0x1000, secOffset + 12); // VirtualAddress
  pe.writeUInt32LE(0x200, secOffset + 16); // SizeOfRawData
  pe.writeUInt32LE(0x200, secOffset + 20); // PointerToRawData
  pe.writeUInt32LE(0x60000020, secOffset + 36); // Characteristics: CODE | EXECUTE | READ

  // Section 2: .rdata
  const sec2Offset = secOffset + 40;
  pe.write('.rdata\0\0', sec2Offset, 'ascii');
  pe.writeUInt32LE(0x100, sec2Offset + 8); // VirtualSize
  pe.writeUInt32LE(0x2000, sec2Offset + 12); // VirtualAddress
  pe.writeUInt32LE(0x200, sec2Offset + 16); // SizeOfRawData
  pe.writeUInt32LE(0x400, sec2Offset + 20); // PointerToRawData
  pe.writeUInt32LE(0x40000040, sec2Offset + 36); // Characteristics: INITIALIZED_DATA | READ

  // Benign raw code in .text (offset 0x200)
  pe[0x200] = 0x31;
  pe[0x201] = 0xc0; // xor eax, eax
  pe[0x202] = 0xc3; // ret

  // Benign strings in .rdata (offset 0x400)
  const peStr = Buffer.from('SRE_STUDIO_BENIGN_PE_SAMPLE_v1.0\0', 'utf8');
  peStr.copy(pe, 0x400);

  return pe;
}

// ── 3. Benign APK Archive (Valid ZIP file structure) ─────────────────────────
// Calculates standard IEEE 802.3 CRC32
function crc32(buffer) {
  let crc = 0xffffffff;
  for (let i = 0; i < buffer.length; i++) {
    const byte = buffer[i];
    crc ^= byte;
    for (let j = 0; j < 8; j++) {
      const mask = -(crc & 1);
      crc = (crc >>> 1) ^ (0xedb88320 & mask);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function buildBenignApk() {
  const manifestXml = `<?xml version="1.0" encoding="utf-8"?>
<manifest xmlns:android="http://schemas.android.com/apk/res/android"
    package="org.srestudio.sampleapp"
    android:versionCode="1"
    android:versionName="1.0.0">
    <uses-sdk android:minSdkVersion="26" android:targetSdkVersion="34" />
    <uses-permission android:name="android.permission.INTERNET" />
    <uses-permission android:name="android.permission.ACCESS_NETWORK_STATE" />
    <application
        android:label="SRE Studio Sample"
        android:allowBackup="false">
        <activity
            android:name=".MainActivity"
            android:exported="true">
            <intent-filter>
                <action android:name="android.intent.action.MAIN" />
                <category android:name="android.intent.category.LAUNCHER" />
            </intent-filter>
        </activity>
    </application>
</manifest>`;

  // Minimal valid DEX header (magic: 'dex\n035\0')
  const dexHeader = Buffer.alloc(112);
  dexHeader.write('dex\n035\0', 0, 'ascii');
  dexHeader.writeUInt32LE(112, 32); // file_size
  dexHeader.writeUInt32LE(112, 36); // header_size
  dexHeader.writeUInt32LE(0x12345678, 40); // endian_tag

  const entries = [
    { name: 'AndroidManifest.xml', data: Buffer.from(manifestXml, 'utf8') },
    { name: 'classes.dex', data: dexHeader },
    { name: 'res/values/strings.xml', data: Buffer.from('<resources><string name="app_name">SRE Studio Sample</string></resources>', 'utf8') },
  ];

  const localHeaders = [];
  const centralHeaders = [];
  let offset = 0;

  for (const entry of entries) {
    const nameBuf = Buffer.from(entry.name, 'utf8');
    const dataBuf = entry.data;
    const crc = crc32(dataBuf);
    const size = dataBuf.length;

    // Local Header
    const local = Buffer.alloc(30 + nameBuf.length + size);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0, 6);
    local.writeUInt16LE(0, 8); // Store method
    local.writeUInt16LE(0, 10);
    local.writeUInt16LE(0, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(size, 18);
    local.writeUInt32LE(size, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    local.writeUInt16LE(0, 28);
    nameBuf.copy(local, 30);
    dataBuf.copy(local, 30 + nameBuf.length);
    localHeaders.push(local);

    // Central Header
    const central = Buffer.alloc(46 + nameBuf.length);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0, 8);
    central.writeUInt16LE(0, 10);
    central.writeUInt16LE(0, 12);
    central.writeUInt16LE(0, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(size, 20);
    central.writeUInt32LE(size, 24);
    central.writeUInt16LE(nameBuf.length, 28);
    central.writeUInt16LE(0, 30);
    central.writeUInt16LE(0, 32);
    central.writeUInt16LE(0, 34);
    central.writeUInt16LE(0, 36);
    central.writeUInt32LE(0, 38);
    central.writeUInt32LE(offset, 42);
    nameBuf.copy(central, 46);
    centralHeaders.push(central);

    offset += local.length;
  }

  const cdOffset = offset;
  const cdSize = centralHeaders.reduce((sum, h) => sum + h.length, 0);

  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(cdSize, 12);
  eocd.writeUInt32LE(cdOffset, 16);
  eocd.writeUInt16LE(0, 20);

  return Buffer.concat([...localHeaders, ...centralHeaders, eocd]);
}

// Write files
const elfBuffer = buildBenignElf();
const peBuffer = buildBenignPe();
const apkBuffer = buildBenignApk();

fs.writeFileSync(path.join(binariesDir, 'sample.elf'), elfBuffer);
fs.writeFileSync(path.join(binariesDir, 'sample.exe'), peBuffer);
fs.writeFileSync(path.join(apksDir, 'sample.apk'), apkBuffer);

console.log('Successfully generated sample fixtures:');
console.log(`  ELF sample: ${path.join(binariesDir, 'sample.elf')} (${elfBuffer.length} bytes)`);
console.log(`  PE sample:  ${path.join(binariesDir, 'sample.exe')} (${peBuffer.length} bytes)`);
console.log(`  APK sample: ${path.join(apksDir, 'sample.apk')} (${apkBuffer.length} bytes)`);
