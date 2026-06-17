# Contributing

Thanks for helping improve Open Chiller Service Viewer.

This project is aimed at practical HVAC service work: live values, clean profiles, snapshots, logs, and safer controller investigation.

## Good Contributions

- New machine profiles based on register maps you are allowed to share.
- Corrections to scaling, signed values, register offsets, units, invalid raw values, and enum text.
- Profile builder improvements for messy manufacturer CSV/PDF exports.
- Better handling of 32-bit values and swapped word order.
- Clear field documentation and troubleshooting notes.
- UI improvements that reduce friction during service work.

## Please Do Not Submit

- Customer names, site names, serial numbers, IP addresses, or service logs.
- Passwords, unlock codes, or bypass instructions.
- Proprietary OEM software, copied manuals, or private documentation.
- Profiles that you are not allowed to share.
- Write features that bypass the safety checks.

## Profile Guidelines

Profiles should be JSON files with a clear name and connection defaults:

```json
{
  "name": "Example chiller field view",
  "connection": {
    "protocol": "Modbus RTU",
    "baudRate": 19200,
    "serial": "8N1",
    "slaveId": 1,
    "offset": 0
  },
  "registers": []
}
```

For each point, include as much as is known:

```json
{
  "group": "Pressures",
  "name": "Suction pressure",
  "register": 8855,
  "function": "03",
  "scale": 0.1,
  "unit": "barA",
  "notes": "Confirm against controller display",
  "signed": true
}
```

If the register map has RW information, preserve it:

```json
{
  "group": "Config",
  "name": "Liquid valve control type",
  "register": 7210,
  "function": "03",
  "scale": 1,
  "access": "RW",
  "min": 0,
  "max": 10,
  "enum": "0=Off|1=Liq|10=Other",
  "writable": true
}
```

RW metadata does not make the browser viewer writable. It is used by the separate guarded write workflow.

## Testing A Profile

Before sharing a profile:

1. Confirm the slave ID, baud, serial format, and offset.
2. Compare at least three known values against the controller display.
3. Confirm units and scale.
4. Check unavailable/fault raw values such as `32767`, `65535`, `-888`, or `-999`.
5. Use a small field-view profile for service work rather than thousands of unused registers.

## Reporting Issues

When reporting a problem, include:

- controller or machine model
- profile name
- baud, serial format, slave ID, and offset
- register number and expected value
- screenshot or anonymised CSV snapshot if useful

Remove customer/site information before sharing.
