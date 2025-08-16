"use client";

import { atomWithStorage } from "jotai/utils";

export const siteKeyAtom = atomWithStorage<string | null>("siteKey", null);
