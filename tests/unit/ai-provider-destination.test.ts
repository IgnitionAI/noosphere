import { expect, test } from "bun:test";
import { parseProviderDestination, resolveProviderDestination } from "@outbound/infrastructure/ai/provider-destination";

test("custom provider URLs admit HTTPS public endpoints only", () => {
  expect(parseProviderDestination("https://llm.example.com/v1/").href).toBe("https://llm.example.com/v1/");
  for (const url of ["http://public.example/v1", "https://user:secret@public.example/v1", "https://public.example:8443/v1", "https://public.example/v1?key=secret", "https://public.example/#fragment", "https://localhost/v1", "https://postgres/v1"]) {
    expect(() => parseProviderDestination(url)).toThrow("AI_PROVIDER_DESTINATION_FORBIDDEN");
  }
});
test("DNS validation rejects private, metadata, mixed and mapped addresses before a credential can be sent", async () => {
  for (const address of ["127.0.0.1", "10.1.1.1", "169.254.169.254", "172.16.0.1", "192.168.1.1", "100.64.0.1", "0.0.0.0", "224.0.0.1", "192.0.2.1", "::1", "fc00::1", "fe80::1", "::ffff:127.0.0.1", "2001:db8::1"]) {
    await expect(resolveProviderDestination("https://llm.example.com/v1", async () => [{ address, family: address.includes(":") ? 6 : 4 }])).rejects.toThrow("AI_PROVIDER_DESTINATION_FORBIDDEN");
  }
  await expect(resolveProviderDestination("https://llm.example.com/v1", async () => [{ address: "8.8.8.8", family: 4 }, { address: "10.0.0.1", family: 4 }])).rejects.toThrow("AI_PROVIDER_DESTINATION_FORBIDDEN");
  const destination = await resolveProviderDestination("https://llm.example.com/v1", async () => [{ address: "8.8.8.8", family: 4 }]);
  expect(destination.address).toBe("8.8.8.8");
  expect(destination.url.hostname).toBe("llm.example.com");
});
