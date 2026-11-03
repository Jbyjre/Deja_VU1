"""
Finding printers on the home network, and testing an address before it is
added - so nobody has to look up an IP address first.

Two ways to find them, both with the standard library only:

1. Asking. Moonraker announces itself over multicast DNS (mDNS, the
   "Bonjour"/".local" protocol). Snapmaker's U1 build announces
   `_snapmaker._tcp.local.` with its address in the record's text
   (github.com/Snapmaker/u1-moonraker a308cfa, moonraker/components/
   zeroconf.py; lava/moonraker.conf turns it on); stock Moonraker announces
   `_moonraker._tcp.local.`. The question is sent from an ordinary port, so
   responders answer this computer directly (RFC 6762's "legacy unicast").
2. Looking. Where a router drops multicast, every address on each of this
   computer's own home networks (private /24s only) is tried on port 7125,
   Moonraker's port in the U1's shipped config.
3. Looking further, when asked (wider=True): the address ranges home routers
   commonly hand out, so a printer on a second router, a mesh system or an
   extender with its own range is found where the routers pass traffic between
   them; and your Tailscale network: each online device's own address and the
   home networks a device there shares (subnet routes), which is how a
   computer away from home reaches a U1 at home. Snapmaker's own app reaches a
   U1 from another network through Snapmaker's cloud (the printer keeps a
   connection out to it); Deja Vu1 has no cloud of its own, so it goes through
   networks you control.

Whatever is found is then asked what it is (GET /server/info and
/printer/objects/list), so the list only shows real Moonrakers, says which
are U1s, and says in words which need an API key.
"""

import ipaddress
import random
import re
import select
import socket
import struct
import threading
import time
from concurrent.futures import ThreadPoolExecutor

import outbound
import remote

MOONRAKER_PORT = 7125
SERVICES = ("_snapmaker._tcp.local.", "_moonraker._tcp.local.")
MDNS_ADDR = ("224.0.0.251", 5353)
_lock = threading.Lock()


# -- multicast DNS -------------------------------------------------------------

def _encode_name(name):
    out = b""
    for label in name.rstrip(".").split("."):
        raw = label.encode("utf-8")
        out += bytes([len(raw)]) + raw
    return out + b"\x00"


def build_query(services=SERVICES):
    """One DNS question per service: PTR, class IN with the unicast bit."""
    header = struct.pack(">HHHHHH", random.randint(0, 0xFFFF), 0, len(services), 0, 0, 0)
    return header + b"".join(_encode_name(s) + struct.pack(">HH", 12, 0x8001) for s in services)


def _read_name(data, pos, depth=0):
    labels = []
    while True:
        if pos >= len(data) or depth > 20:
            raise ValueError("name runs past the packet")
        length = data[pos]
        if length & 0xC0 == 0xC0:                     # a pointer to a name earlier on
            target = ((length & 0x3F) << 8) | data[pos + 1]
            name, _ = _read_name(data, target, depth + 1)
            labels.append(name)
            return ".".join(l for l in labels if l), pos + 2
        if length == 0:
            return ".".join(labels), pos + 1
        labels.append(data[pos + 1:pos + 1 + length].decode("utf-8", "replace"))
        pos += 1 + length


def parse_response(data):
    """The records in one mDNS answer: {"ptr": [...], "srv": {}, "txt": {}, "a": {}}."""
    out = {"ptr": [], "srv": {}, "txt": {}, "a": {}}
    if len(data) < 12:
        return out
    _id, flags, qd, an, ns, ar = struct.unpack(">HHHHHH", data[:12])
    pos = 12
    for _ in range(qd):
        _, pos = _read_name(data, pos)
        pos += 4
    for _ in range(an + ns + ar):
        name, pos = _read_name(data, pos)
        rtype, _cls, _ttl, rdlen = struct.unpack(">HHIH", data[pos:pos + 10])
        pos += 10
        rdata = data[pos:pos + rdlen]
        if rtype == 12:                                            # PTR
            out["ptr"].append(_read_name(data, pos)[0])
        elif rtype == 33 and rdlen >= 6:                           # SRV
            _prio, _weight, port = struct.unpack(">HHH", rdata[:6])
            out["srv"][name] = {"port": port, "target": _read_name(data, pos + 6)[0]}
        elif rtype == 16:                                          # TXT
            props, i = {}, 0
            while i < len(rdata):
                n = rdata[i]
                item = rdata[i + 1:i + 1 + n].decode("utf-8", "replace")
                key, _, value = item.partition("=")
                props[key] = value
                i += 1 + n
            out["txt"][name] = props
        elif rtype == 1 and rdlen == 4:                            # A
            out["a"][name] = socket.inet_ntoa(rdata)
        pos += rdlen
    return out


def _from_records(records):
    """Printers in a merged set of records: [{"ip", "port", "name", "u1"}]."""
    found = []
    for instance in records["ptr"]:
        srv = records["srv"].get(instance, {})
        txt = records["txt"].get(instance, {})
        ip = txt.get("ip") or records["a"].get(srv.get("target", ""))
        if not ip:
            continue
        snapmaker = instance.endswith("_snapmaker._tcp.local")
        # The U1's record advertises its LAN MQTT port; Moonraker is on 7125.
        port = MOONRAKER_PORT if snapmaker else srv.get("port") or MOONRAKER_PORT
        found.append({"ip": ip, "port": port, "name": txt.get("device_name") or instance.split(".")[0],
                      "u1": snapmaker or txt.get("machine_type", "").upper().startswith("U1"),
                      # The U1 announces its serial number (u1-moonraker zeroconf.py "sn").
                      "serial": (txt.get("sn") or "").strip().upper()[:40] or None})
    return found


def ask_network(wait=1.5):
    """
    Ask the network who runs Moonraker, from every home-network connection this computer has
    (Wi-Fi and a cable can be on different networks). Returns what answered.
    """
    records = {"ptr": [], "srv": {}, "txt": {}, "a": {}}
    socks = []
    for addr in home_addresses() or [""]:
        try:
            sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM, socket.IPPROTO_UDP)
        except OSError:
            continue
        try:
            sock.setsockopt(socket.IPPROTO_IP, socket.IP_MULTICAST_TTL, 255)
            if addr:
                # Out of this connection, and the answers back to it (RFC 6762 legacy unicast).
                sock.setsockopt(socket.IPPROTO_IP, socket.IP_MULTICAST_IF, socket.inet_aton(addr))
            sock.bind((addr, 0))
            sock.setblocking(False)
            sock.sendto(build_query(), MDNS_ADDR)
            socks.append(sock)
        except OSError:
            sock.close()
    try:
        end = time.monotonic() + wait
        while socks and time.monotonic() < end:
            ready, _, _ = select.select(socks, [], [], 0.25)
            for sock in ready:
                try:
                    data, _ = sock.recvfrom(9000)
                    got = parse_response(data)
                except (OSError, ValueError, struct.error, IndexError):
                    continue
                records["ptr"] += [p for p in got["ptr"] if p not in records["ptr"]]
                for k in ("srv", "txt", "a"):
                    records[k].update(got[k])
    finally:
        for sock in socks:
            sock.close()
    return _from_records(records)


# -- the home network, port 7125 -------------------------------------------------

HOME_RANGES = ("10.0.0.0/8", "172.16.0.0/12", "192.168.0.0/16")


def home_address():
    """This computer's address on a home network (RFC 1918), or None."""
    try:
        with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as s:
            s.connect(("192.0.2.1", 9))           # picks the interface; sends nothing
            ip = ipaddress.ip_address(s.getsockname()[0])
    except (OSError, ValueError):
        return None
    return str(ip) if any(ip in ipaddress.ip_network(n) for n in HOME_RANGES) else None


def home_addresses():
    """
    Every home-network address this computer has, the one its internet
    traffic leaves by first. A computer with a VPN, a virtual machine or both
    Wi-Fi and a cable has several, and the first is not always the one the
    phone's Wi-Fi can reach, so the phone screen offers the others too.
    """
    found = []
    first = home_address()
    if first:
        found.append(first)
    try:
        infos = socket.getaddrinfo(socket.gethostname(), None, socket.AF_INET)
    except (OSError, UnicodeError):
        infos = []
    for info in infos:
        try:
            ip = ipaddress.ip_address(info[4][0])
        except ValueError:
            continue
        if any(ip in ipaddress.ip_network(n) for n in HOME_RANGES) and str(ip) not in found:
            found.append(str(ip))
    return found[:6]


def home_network():
    """This computer's own home-network /24, or None (no route, or not a home range)."""
    ip = home_address()
    if ip is None:
        return None
    # Only the three ranges home routers hand out (RFC 1918): never a
    # public, carrier or documentation range (home_address checks).
    return ipaddress.ip_network(f"{ip}/24", strict=False)


def home_networks():
    """Every home-network /24 this computer is on (its main connection first), at most four."""
    nets = []
    for ip in home_addresses():
        net = ipaddress.ip_network(f"{ip}/24", strict=False)
        if net not in nets:
            nets.append(net)
    return nets[:4]


# Address ranges home routers commonly hand out. Tried only when someone asks to look further,
# and only where this computer's own routers pass the traffic on: nothing leaves the home.
COMMON_HOME_NETWORKS = (
    "192.168.0.0/24", "192.168.1.0/24", "192.168.2.0/24", "192.168.4.0/24", "192.168.8.0/24",
    "192.168.10.0/24", "192.168.31.0/24", "192.168.50.0/24", "192.168.68.0/24", "192.168.86.0/24",
    "192.168.100.0/24", "192.168.178.0/24", "10.0.0.0/24", "10.0.1.0/24", "10.1.1.0/24", "172.16.0.0/24",
)


def wider_places(tailnet=None):
    """
    Where to look further: [(network, why)] and single Tailscale addresses [(ip, why)].
    A tailnet route larger than a /22 is skipped (too many addresses to try).
    """
    own = home_networks()
    nets = [(ipaddress.ip_network(n), "a range home routers often use") for n in COMMON_HOME_NETWORKS]
    nets = [(n, why) for n, why in nets if n not in own]
    hosts = []
    tailnet = remote.tailnet_places() if tailnet is None else tailnet
    for route in tailnet.get("routes") or []:
        try:
            net = ipaddress.ip_network(route, strict=False)
        except ValueError:
            continue
        if net.prefixlen < 22 or not any(net.subnet_of(ipaddress.ip_network(r)) for r in HOME_RANGES):
            continue
        for sub in (net.subnets(new_prefix=24) if net.prefixlen < 24 else [net]):
            if sub not in own and sub not in [n for n, _ in nets]:
                nets.insert(0, (sub, "shared on your Tailscale network"))
    for peer in tailnet.get("peers") or []:
        for ip in peer.get("ips") or []:
            hosts.append((ip, f"{peer.get('name') or 'a device'} on your Tailscale network"))
    return nets[:24], hosts[:40]


def _open(ip, port, timeout):
    try:
        with socket.create_connection((str(ip), port), timeout=timeout):
            return True
    except OSError:
        return False


def sweep(network, port=MOONRAKER_PORT, timeout=0.4):
    """Every address on `network` with something listening on `port`."""
    return sweep_many([network], port, timeout)


def sweep_many(networks, port=MOONRAKER_PORT, timeout=0.4, singles=()):
    """Every address on these networks (and these single addresses) with something listening on `port`."""
    hosts = [h for net in networks for h in list(net.hosts())[:254]] + [ipaddress.ip_address(h) for h in singles]
    with ThreadPoolExecutor(max_workers=128) as pool:
        hits = pool.map(lambda h: (h, _open(h, port, timeout)), hosts)
        return [str(h) for h, ok in hits if ok]


# -- what is it? -------------------------------------------------------------------

def probe(url, api_key=None, timeout=3.0):
    """
    Ask an address what it is. Always an answer in words:
    {"ok", "url", "moonraker_version", "klippy_state", "u1", "toolheads",
     "needs_key", "error"}.
    """
    url = str(url or "").strip().rstrip("/")
    headers = {"X-Api-Key": api_key} if api_key else None
    out = {"ok": False, "url": url, "moonraker_version": None, "klippy_state": None, "u1": None,
           "toolheads": None, "needs_key": False, "error": None}
    info = outbound.send(f"{url}/server/info", "the printer", method="GET", headers=headers, timeout=timeout)
    if not info["ok"]:
        if info.get("status") in (401, 403):
            out["needs_key"] = True
            out["error"] = ("The printer answered and asks for a sign-in. Enter the username and "
                            "password from its web page (or its API key)")
        else:
            out["error"] = info["error"]
        return out
    result = info["body"].get("result") if isinstance(info["body"], dict) else None
    if not isinstance(result, dict) or "klippy_state" not in result:
        out["error"] = "Something answered there, but it isn't Moonraker"
        return out
    out.update(ok=True, moonraker_version=result.get("moonraker_version"), klippy_state=result.get("klippy_state"))
    objects = outbound.send(f"{url}/printer/objects/list", "the printer", method="GET", headers=headers, timeout=timeout)
    names = (objects["body"].get("result") or {}).get("objects", []) if objects["ok"] and isinstance(objects["body"], dict) else []
    if names:
        out["toolheads"] = sum(1 for n in names if n == "extruder" or (n.startswith("extruder") and n[8:].isdigit()))
        # print_task_config is Snapmaker's own object (u1-klipper).
        out["u1"] = "print_task_config" in names
    # Snapmaker's Moonraker names the model and its serial number (u1-moonraker machine.py product_info):
    # the serial lets Deja Vu1 recognise the same printer at a new address.
    out["serial"] = None
    system = outbound.send(f"{url}/machine/system_info", "the printer", method="GET", headers=headers, timeout=timeout)
    if system["ok"] and isinstance(system["body"], dict):
        product = ((system["body"].get("result") or {}).get("system_info") or {}).get("product_info") or {}
        if isinstance(product, dict):
            serial = str(product.get("serial_number") or "").strip().upper()[:40]
            out["serial"] = serial or None
            if str(product.get("machine_type") or "").strip().lower() == "snapmaker u1":
                out["u1"] = True
    if out["klippy_state"] != "ready":
        out["error"] = f"Moonraker is running, but Klipper is {out['klippy_state']} - the printer may still be starting"
    return out


def key_from_login(url, username, password, timeout=6.0):
    """
    The printer's Moonraker API key, read once with its own username and
    password, for printers whose web page asks for a login (the Extended
    Firmware's "Web Authentication" creates an "admin" user and switches off
    the trusted-network rule). Moonraker's routes, from its source
    (moonraker/components/authorization.py): POST /access/login
    {username, password, source} -> {"token", ...}; GET /access/api_key with
    "Authorization: Bearer <token>" -> the key. The password is used for
    these two requests only and never saved; the key is what gets saved.
    """
    url = str(url or "").strip().rstrip("/")
    username = str(username or "").strip()
    if not username or not password:
        raise ValueError("Enter the username and password you use for the printer's web page")
    login = outbound.send(f"{url}/access/login", "the printer", method="POST", timeout=timeout,
                          payload={"username": username, "password": str(password), "source": "moonraker"})
    if not login["ok"]:
        reason = login["error"] or ""
        if login.get("status") in (400, 401, 403, 404) or "Invalid Password" in reason or "Unregistered" in reason:
            raise ValueError("The printer didn't accept that username and password. "
                             "Check them on the printer's own web page and try again")
        raise ValueError(reason or "The printer didn't answer the sign-in")
    body = login.get("body")
    token = ((body or {}).get("result") or {}).get("token") if isinstance(body, dict) else None
    if not isinstance(token, str) or not token:
        raise ValueError("The printer answered the sign-in, but without a sign-in token")
    key = outbound.send(f"{url}/access/api_key", "the printer", method="GET", timeout=timeout,
                        headers={"Authorization": f"Bearer {token}"})
    result = key["body"].get("result") if key["ok"] and isinstance(key.get("body"), dict) else None
    if not isinstance(result, str) or not re.fullmatch(r"[A-Za-z0-9_\-]{8,128}", result):
        raise ValueError(key.get("error") or "The printer signed you in but didn't hand over its API key")
    return result


def discover(registered_urls=(), wait=1.5, sweep_network=True, hosts=None, wider=False, tailnet=None):
    """
    Everything that answers as Moonraker, checked. wider=True also looks on nearby home ranges and
    your Tailscale network (wider_places). `hosts` (["127.0.0.1:7125", ...]) replaces asking and
    sweeping, for tests.
    """
    if not _lock.acquire(blocking=False):
        raise ValueError("Already looking - give it a few seconds")
    try:
        started = time.monotonic()
        candidates = {}
        how = []
        if hosts is not None:
            for h in hosts:
                ip, _, port = h.partition(":")
                candidates[(ip, int(port or MOONRAKER_PORT))] = {"name": None, "u1": None, "serial": None,
                                                                 "source": "given", "where": None}
        else:
            for f in ask_network(wait):
                candidates[(f["ip"], f["port"])] = {"name": f["name"], "u1": f["u1"], "serial": f.get("serial"),
                                                    "source": "announced itself", "where": None}
            how.append("asked the network (mDNS)")
            nets = home_networks() if sweep_network else []
            for ip in sweep_many(nets):
                candidates.setdefault((ip, MOONRAKER_PORT), {"name": None, "u1": None, "serial": None,
                                                            "source": "port 7125 open", "where": "this network"})
            if nets:
                how.append(f"tried port {MOONRAKER_PORT} on " + ", ".join(str(n) for n in nets))
            elif sweep_network:
                how.append("couldn't tell which home network this computer is on, so didn't try addresses")
            if wider:
                far, singles = wider_places(tailnet)
                why = {}
                for net, reason in far:
                    why[str(net)] = reason
                for ip in sweep_many([n for n, _ in far], timeout=0.35, singles=[h for h, _ in singles]):
                    reason = next((r for h, r in singles if h == ip), None) or next(
                        (why[str(n)] for n, _ in far if ipaddress.ip_address(ip) in n), "further away")
                    candidates.setdefault((ip, MOONRAKER_PORT), {"name": None, "u1": None, "serial": None,
                                                                "source": "port 7125 open", "where": reason})
                tail = sum(1 for _, r in far if "Tailscale" in r)
                how.append(f"looked further: {len(far)} more address ranges"
                           + (f" ({tail} shared on your Tailscale network)" if tail else "")
                           + (f" and {len(singles)} Tailscale devices" if singles else ""))
        known = {u.rstrip("/") for u in registered_urls}

        def check(item):
            (ip, port), seen = item
            url = f"http://{ip}:{port}"
            r = probe(url, timeout=2.5)
            return {**r, "ip": ip, "port": port, "name": seen["name"], "source": seen["source"],
                    "where": seen.get("where"), "serial": r.get("serial") or seen.get("serial"),
                    "u1": r["u1"] if r["u1"] is not None else seen["u1"], "added": url in known}
        with ThreadPoolExecutor(max_workers=16) as pool:
            found = [r for r in pool.map(check, candidates.items()) if r["ok"] or r["needs_key"]]
        found.sort(key=lambda r: (not r["u1"], r["ip"]))
        return {"printers": found, "how": how, "seconds": round(time.monotonic() - started, 1), "wider": bool(wider)}
    finally:
        _lock.release()
