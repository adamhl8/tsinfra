import { regex } from "arkregex"

type OctalDigit = "0" | "1" | "2" | "3" | "4" | "5" | "6" | "7"

/** A mode in octal, like `"644"`, or `"4755"` with setuid. */
export type OctalMode =
  | `${OctalDigit}${OctalDigit}${OctalDigit}`
  | `${OctalDigit}${OctalDigit}${OctalDigit}${OctalDigit}`

// Give `OCTAL_MODE_PATTERN` its type, because `regex` infers `[0-7]{3,4}` as any number.
export const OCTAL_MODE_PATTERN = regex.as<OctalMode>("^[0-7]{3,4}$", "v")

// Allow `s` and `S` in an `x` slot for setuid and setgid, and `t` and `T` for the sticky bit, like `ls -l` prints them.
// Leave off the `v` flag, because it requires escaping `-`, and `regex` can't infer a type from `String.raw`.
export const SYMBOLIC_MODE_PATTERN = regex("^[r-][w-][xsS-][r-][w-][xsS-][r-][w-][xtT-]$")

/** A mode the way `ls -l` prints it, like `"rw-r--r--"`: read, write, and execute for the owner, the group, and others. */
export type SymbolicMode = typeof SYMBOLIC_MODE_PATTERN.infer

/** A file's mode, in octal like `"644"`, or symbolic like `"rw-r--r--"`. */
export type FileMode = OctalMode | SymbolicMode

/** Owner reads and writes, everyone else reads. The usual mode for a config file. Octal `644`. */
export const PUBLIC_FILE_MODE = "rw-r--r--" satisfies SymbolicMode
/**
 * Owner reads and writes, the group reads, others get nothing. For a secret a service reads through its group. Octal
 * `640`.
 */
export const GROUP_FILE_MODE = "rw-r-----" satisfies SymbolicMode
/** Only the owner reads and writes. For keys, tokens, and other secrets. Octal `600`. */
export const PRIVATE_FILE_MODE = "rw-------" satisfies SymbolicMode
/** Owner reads, writes, and runs it, everyone else reads and runs it. For a script or a binary. Octal `755`. */
export const PUBLIC_EXECUTABLE_MODE = "rwxr-xr-x" satisfies SymbolicMode
/** Owner reads, writes, and runs it, the group reads and runs it, others get nothing. Octal `750`. */
export const GROUP_EXECUTABLE_MODE = "rwxr-x---" satisfies SymbolicMode
/** Only the owner reads, writes, and runs it. Octal `700`. */
export const PRIVATE_EXECUTABLE_MODE = "rwx------" satisfies SymbolicMode

const PERMISSION_LETTERS = "rwx"
// Index the setuid, setgid, and sticky bits by triple: owner, group, others.
const SPECIAL_BITS = [0o4000, 0o2000, 0o1000]
const SPECIAL_LETTERS = ["s", "s", "t"]
const SPECIAL_CHARS = "sStT"
// Treat `S` and `T` as a special bit without execute, the way `ls -l` prints it.
const SPECIAL_WITHOUT_EXECUTE = "ST"
const TRIPLE_LENGTH = 3
const SYMBOLIC_LENGTH = 9

// Use arithmetic, because the lint config bans bitwise operators.
// Each bit is a distinct power of 2, so adding bits never carries.
const hasBit = (bits: number, bit: number) => Math.floor(bits / bit) % 2 === 1

// Return a plain `boolean`, because narrowing `FileMode` by every symbolic mode slows the whole type check.
const isSymbolicMode = (mode: FileMode): boolean => SYMBOLIC_MODE_PATTERN.test(mode)

/** Converts `mode` to its permission bits. */
export const toModeBits = (mode: FileMode) => {
  if (!isSymbolicMode(mode)) return Number.parseInt(mode, 8)

  let bits = 0
  // oxlint-disable-next-line typescript/no-misused-spread - `mode` matched `SYMBOLIC_MODE_PATTERN`, so it's all ASCII
  for (const [index, char] of [...mode].entries()) {
    const permissionBit = 2 ** (SYMBOLIC_LENGTH - 1 - index)
    const isGranted = char !== "-" && !SPECIAL_WITHOUT_EXECUTE.includes(char)
    if (isGranted) bits += permissionBit

    const specialBit = SPECIAL_BITS[Math.floor(index / TRIPLE_LENGTH)] ?? 0
    if (SPECIAL_CHARS.includes(char)) bits += specialBit
  }
  return bits
}

/** Formats permission bits the way `ls -l` prints them, like `rw-r--r--`. */
const toSymbolicMode = (bits: number) =>
  Array.from({ length: SYMBOLIC_LENGTH }, (_, index) => {
    const tripleIndex = Math.floor(index / TRIPLE_LENGTH)
    const slot = index % TRIPLE_LENGTH
    const isGranted = hasBit(bits, 2 ** (SYMBOLIC_LENGTH - 1 - index))
    const letter = PERMISSION_LETTERS[slot] ?? "-"

    const isExecuteSlot = slot === TRIPLE_LENGTH - 1
    const specialLetter = SPECIAL_LETTERS[tripleIndex] ?? ""
    const hasSpecialBit = isExecuteSlot && hasBit(bits, SPECIAL_BITS[tripleIndex] ?? 0)
    if (hasSpecialBit) return isGranted ? specialLetter : specialLetter.toUpperCase()

    return isGranted ? letter : "-"
  }).join("")

/** Formats permission bits as both notations, like `rw-r--r-- (644)`. */
export const formatMode = (bits: number) => `${toSymbolicMode(bits)} (${bits.toString(8).padStart(TRIPLE_LENGTH, "0")})`
