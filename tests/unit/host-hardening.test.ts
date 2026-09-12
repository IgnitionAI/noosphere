import { expect, test } from "bun:test";
import { mkdtemp, mkdir, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

async function runHardening(cidr: string, existing = false, inputRules = "", inputRules6 = inputRules) {
  const dir = await mkdtemp(join(tmpdir(), "noosphere-firewall-test-"));
  const bin = join(dir, "bin");
  await mkdir(bin);
  const log = join(dir, "commands");
  await writeFile(log, "");
  for (const name of ["id", "apt-get", "docker", "iptables", "ip6tables", "systemctl", "netfilter-persistent"]) {
    await writeFile(join(bin, name), `#!/bin/sh
if [ "${name}" = id ]; then echo 0; exit 0; fi
printf '%s\\n' '${name}'" $*" >> "$COMMAND_LOG"
if [ "$1" = -S ]; then printf '%s\\n' "$${name === "ip6tables" ? "INPUT_RULES6" : "INPUT_RULES"}"; exit 0; fi
if [ "$1" = -C ]; then exit ${existing ? 0 : 1}; fi
exit 0
`, { mode: 0o755 });
  }
  const result = Bun.spawnSync(["bash", "deploy/harden-host.sh"], {
    env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, COMMAND_LOG: log, INPUT_RULES: inputRules, INPUT_RULES6: inputRules6, SSH_ALLOWED_CIDR: cidr, EXTERNAL_INTERFACE: "eth0" },
    stdout: "pipe", stderr: "pipe",
  });
  return { code: result.exitCode, commands: await readFile(log, "utf8") };
}

test("invalid SSH CIDR fails before installing or changing firewall rules", async () => {
  const result = await runHardening("not-an-address");
  expect(result.code).not.toBe(0);
  expect(result.commands).toBe("");
});

test("IPv4 SSH remains allowed before INPUT is closed and Docker drop precedes RETURN", async () => {
  const result = await runHardening("192.0.2.10/32");
  expect(result.code).toBe(0);
  expect(result.commands).not.toContain("ufw");
  expect(result.commands.indexOf("iptables -A INPUT -s 192.0.2.10/32")).toBeLessThan(result.commands.indexOf("iptables -P INPUT DROP"));
  expect(result.commands).toContain("iptables -I DOCKER-USER 4 -i eth0 -j DROP");
  expect(result.commands).toContain("ip6tables -A INPUT -p ipv6-icmp -j ACCEPT");
  expect(result.commands).not.toContain(" -F");
});

test("existing rules are preserved and IPv6 administrator addresses use ip6tables", async () => {
  const result = await runHardening("2001:db8::1/128", true);
  expect(result.code).toBe(0);
  expect(result.commands).toContain("ip6tables -C INPUT -s 2001:db8::1/128");
  expect(result.commands).not.toContain(" -A INPUT");
  expect(result.commands).not.toContain(" -I DOCKER-USER");
});


test("rejects broad preexisting SSH access before any host mutation", async () => {
  const result = await runHardening("192.0.2.10/32", false, "-P INPUT ACCEPT\n-A INPUT -p tcp -m tcp --dport 22 -j ACCEPT");
  expect(result.code).not.toBe(0);
  expect(result.commands).not.toContain("apt-get");
  expect(result.commands).not.toMatch(/ -(?:A|I|P|N|F) /);
});

test("accepts only matching managed INPUT rules on repeated hardening", async () => {
  const result = await runHardening("192.0.2.10/32", true, "-P INPUT DROP\n-A INPUT -i lo -j ACCEPT\n-A INPUT -m conntrack --ctstate RELATED,ESTABLISHED -j ACCEPT");
  expect(result.code).toBe(0);
  expect(result.commands).not.toContain(" -A INPUT");
});


test("canonical scoped SSH rules permit idempotent IPv4 and IPv6 reruns", async () => {
  const ipv4 = await runHardening("192.0.2.10", true, "-P INPUT DROP\n-A INPUT -s 192.0.2.10/32 -p tcp -m tcp --dport 22 -j ACCEPT", "-P INPUT DROP");
  const ipv6 = await runHardening("2001:db8::1/128", true, "-P INPUT DROP", "-P INPUT DROP\n-A INPUT -s 2001:db8::1/128 -p tcp -m tcp --dport 22 -j ACCEPT");
  expect(ipv4.code).toBe(0);
  expect(ipv6.code).toBe(0);
  expect(ipv4.commands).not.toContain(" -A INPUT");
  expect(ipv6.commands).not.toContain(" -A INPUT");
});

test("changing the administrator CIDR refuses the old permission without modifying it", async () => {
  const result = await runHardening("192.0.2.20/32", true, "-A INPUT -s 192.0.2.10/32 -p tcp -m tcp --dport 22 -j ACCEPT");
  expect(result.code).not.toBe(0);
  expect(result.commands).not.toContain("apt-get");
  expect(result.commands).not.toMatch(/ -(?:A|I|P|N|F) /);
});
