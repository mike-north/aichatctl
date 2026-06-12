import { describe, expect, it } from "@jest/globals";

import { hashContent } from "./hash.js";

describe("hashContent", () => {
  it("is deterministic for identical content", () => {
    expect(hashContent("hello")).toBe(hashContent("hello"));
  });

  it("differs for different content", () => {
    expect(hashContent("a")).not.toBe(hashContent("b"));
  });

  it("matches the known sha256 of a fixed input", () => {
    // echo -n "abc" | shasum -a 256
    expect(hashContent("abc")).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
  });

  it("treats equal Buffer and string content identically", () => {
    expect(hashContent(Buffer.from("xyz", "utf8"))).toBe(hashContent("xyz"));
  });
});
