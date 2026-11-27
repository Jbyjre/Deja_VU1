"""Stand-in for the chip: an id and 4096 bytes of non-volatile memory that start erased."""


class _Cpu:
    uid = b"\xde\xad\xbe\xef\x00\x00\x00\x02"


cpu = _Cpu()
nvm = bytearray(b"\xff" * 4096)
