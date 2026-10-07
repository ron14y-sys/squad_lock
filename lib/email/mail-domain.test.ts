import { describe, expect, it, vi } from "vitest";

import { domainAcceptsMail } from "./mail-domain";

function dnsError(code: string) {
  return Object.assign(new Error(code), { code });
}

/** A resolver whose three lookups answer as given: a list, or an error code. */
function resolver(answers: {
  mx?: unknown[] | string;
  a?: unknown[] | string;
  aaaa?: unknown[] | string;
}) {
  const answer = (value: unknown[] | string | undefined) => async () => {
    if (typeof value === "string") throw dnsError(value);
    return value ?? [];
  };
  return {
    resolveMx: vi.fn(answer(answers.mx)),
    resolve4: vi.fn(answer(answers.a)),
    resolve6: vi.fn(answer(answers.aaaa)),
  } as unknown as Parameters<typeof domainAcceptsMail>[1];
}

describe("domainAcceptsMail", () => {
  it("accepts a domain with an MX record", async () => {
    const dns = resolver({ mx: [{ exchange: "mx.gmail.com", priority: 5 }] });

    expect(await domainAcceptsMail("ron@gmail.com", dns)).toBe(true);
    expect(dns!.resolveMx).toHaveBeenCalledWith("gmail.com");
  });

  it("refuses a domain that does not exist, like a typo for gmail.com", async () => {
    const dns = resolver({
      mx: "ENOTFOUND",
      a: "ENOTFOUND",
      aaaa: "ENOTFOUND",
    });

    expect(await domainAcceptsMail("ron@gmail.con", dns)).toBe(false);
  });

  it("refuses a domain that exists but has nowhere to deliver", async () => {
    const dns = resolver({ mx: "ENODATA", a: "ENODATA", aaaa: "ENODATA" });

    expect(await domainAcceptsMail("ron@parked.example", dns)).toBe(false);
  });

  it("accepts a domain with no MX but an address record (RFC 5321 fallback)", async () => {
    const dns = resolver({ mx: "ENODATA", a: ["192.0.2.1"] });

    expect(await domainAcceptsMail("ron@small.example", dns)).toBe(true);
  });

  it("accepts when DNS itself fails — an outage must not block an invite", async () => {
    const dns = resolver({ mx: "ETIMEOUT" });

    expect(await domainAcceptsMail("ron@gmail.com", dns)).toBe(true);
  });
});
