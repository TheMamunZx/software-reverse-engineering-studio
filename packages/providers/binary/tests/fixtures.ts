// Rizin rabin2 -Ij JSON output fixture (minimal ELF binary)
export const rabin2InfoFixture = {
  arch: 'x86',
  bits: 32,
  big_endian: false,
  va: true,
  class: 'ELF32',
  lang: 'c',
  os: 'linux',
  has_va: true,
  static: false,
  stripped: false,
  relocs: true,
  nx: false,
  aslr: false,
  coredump: false,
  pic: false,
  format: 'elf',
  intrp: '/lib/ld-linux.so.2',
  bintype: 'elf',
  machine: 'i386',
  endian: 'little',
};

// Rizin rabin2 -Sj JSON output fixture (sections)
export const rabin2SectionsFixture = [
  { name: '.text', size: 0x1000, vaddr: 0x08048000, paddr: 0x08048000, perm: 'r-x', type: 'CODE' },
  { name: '.data', size: 0x200, vaddr: 0x08049000, paddr: 0x08049000, perm: 'rw-', type: 'DATA' },
  { name: '.bss', size: 0x100, vaddr: 0x08049200, paddr: 0x08049200, perm: 'rw-', type: 'NOBITS' },
];

// Rizin rabin2 -sj JSON output fixture (symbols)
export const rabin2SymbolsFixture = [
  { name: 'main', type: 'FUNC', addr: 0x080483a0, size: 0x100 },
  { name: 'printf', type: 'IMPORT', addr: 0x00000000, size: 0 },
  { name: 'exit', type: 'IMPORT', addr: 0x00000000, size: 0 },
  { name: '__libc_start_main', type: 'IMPORT', addr: 0x00000000, size: 0 },
];

// Rizin rabin2 -zj JSON output fixture (strings)
export const rabin2StringsFixture = [
  { vaddr: 0x08048400, size: 11, section: '.rodata', string: 'Hello, World!' },
  { vaddr: 0x0804840c, size: 4, section: '.rodata', string: '%d' },
];

// Rizin rabin2 -ij JSON output fixture (imports)
export const rabin2ImportsFixture = [
  { name: 'printf', plt: 0x080482d0, bind: 'GLOBAL', type: 'FUNC', lib: 'libc.so.6' },
  { name: 'exit', plt: 0x080482e0, bind: 'GLOBAL', type: 'FUNC', lib: 'libc.so.6' },
];

// Rizin agfj JSON output fixture (CFG)
export const rabin2CfgFixture = {
  '0x080483a0': {
    name: 'main',
    addr: '0x080483a0',
    size: 0x100,
    edges: ['0x080483b0', '0x080483c0'],
  },
  '0x08048400': {
    name: 'printf_plt',
    addr: '0x08048400',
    size: 0x10,
    edges: [],
  },
};

// Minimal ELF binary header bytes (not a real binary, but has ELF magic)
export const minimalElfBytes = new Uint8Array([
  0x7f, 0x45, 0x4c, 0x46, // ELF magic
  0x01, // ELFCLASS32
  0x01, // LSB
  0x01, // EV_CURRENT
  0x00, // OS ABI
  0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, // padding
  0x02, 0x00, // ET_EXEC
  0x03, 0x00, // EM_386
  0x01, 0x00, 0x00, 0x00, // EV_CURRENT
  0x00, 0x80, 0x04, 0x08, // entry
  0x34, 0x00, 0x00, 0x00, // phoff
  0x00, 0x00, 0x00, 0x00, // shoff
  0x00, 0x00, 0x00, 0x00, // flags
  0x34, 0x00, // ehsize
  0x20, 0x00, // phentsize
  0x01, 0x00, // phnum
  0x00, 0x00, // shentsize
  0x00, 0x00, // shnum
  0x00, 0x00, // shstrndx
]);
