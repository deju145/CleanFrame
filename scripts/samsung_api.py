"""Optional fixed-TV API overlay. Never reads signing credentials or contacts a TV."""
import ipaddress
import json

SOURCE_ORIGIN = 'http://127.0.0.1:8001'


def validate_host(value):
    try:
        address = ipaddress.IPv4Address(value) if isinstance(value, str) else None
    except ipaddress.AddressValueError:
        address = None
    if address is None or address.is_unspecified or address.is_multicast or address.is_loopback or int(address) == 0xffffffff:
        raise ValueError('Samsung API host must be one TV IPv4 address, without a scheme, port or path.')
    return str(address)


def load_host(root):
    path = root / '.local/samsung-api.json'
    if path.is_symlink():
        raise ValueError('Samsung API settings must be a regular local file, not a symlink.')
    if not path.exists():
        return None
    try:
        config = json.loads(path.read_text())
    except (ValueError, UnicodeError):
        raise ValueError('Invalid .local/samsung-api.json; expected a JSON object with only host.') from None
    if not isinstance(config, dict) or set(config) != {'host'}:
        raise ValueError('Samsung API settings must contain only host.')
    return validate_host(config['host'])


def target_overlay(root, host, manifest):
    host = validate_host(host)
    origin = 'http://' + host + ':8001'
    source = (root / 'app/device.js').read_bytes()
    marker = ('origin="' + SOURCE_ORIGIN + '"').encode()
    ws_marker = ('origin="' + SOURCE_ORIGIN.replace('http:', 'ws:') + '"').encode()
    if manifest.count(marker) != 1 or manifest.count(ws_marker) != 1 or source.count(SOURCE_ORIGIN.encode()) != 1:
        raise ValueError('Samsung API overlay requires the expected single fixed-origin source template.')
    return {
        'config.xml': manifest.replace(marker, ('origin="' + origin + '"').encode()).replace(
            ws_marker, ('origin="' + origin.replace('http:', 'ws:') + '"').encode()),
        'device.js': source.replace(SOURCE_ORIGIN.encode(), origin.encode()),
    }
