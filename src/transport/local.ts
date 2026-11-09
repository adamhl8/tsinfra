import os from "node:os"

import type { Result } from "ts-explicit-errors"

import { runProcess } from "#transport/run-process.ts"
import type { CommandOutput } from "#transport/transport.ts"

const LOCAL_SHELL = ["sh", "-s"]

/** Runs `cmd` in `sh -s` on the control machine, from the home directory, like an SSH session would. */
export const runLocal = async (cmd: string): Promise<Result<CommandOutput>> =>
  runProcess(LOCAL_SHELL, cmd, os.homedir())
