# PJSUA2 RTP Port Configuration Bug

## Problem

PJSUA2 Python bindings **ignore** the `rtp_port` and `rtp_port_range` configuration in `ep_cfg.medConfig`.

**Expected behavior:**
```python
media_cfg.rtp_port = 10000
media_cfg.rtp_port_range = 10000
# Should use ports 10000-20000
```

**Actual behavior:**
- PJSUA uses default port **4000** instead of 10000
- Configuration is silently ignored
- `libGetConfig()` after `libStart()` confirms ports are 4000, not 10000

## Confirmed by diagnostic logs

```
🔧 RTP configuré: port=10000, range=10000 (ports 10000-20000)
# We REQUESTED 10000

✅ DIAGNOSTIC: PJSUA ports RTP RÉELS après libStart(): start=4000, range=100
# But PJSUA actually USES 4000
```

## Root Cause

This is a **bug in PJSUA2 Python bindings**:
- The binding layer doesn't properly transmit `rtp_port` to the C layer
- PJSUA C code falls back to hardcoded default `PJSUA_RTP_PORT_START = 4000`
- Affects multiple PJSUA2 Python versions

## Attempted Workarounds (in code)

We've implemented several workarounds in `pjsua_adapter.py`:

### 1. Environment Variables (lines 29-38)
```python
os.environ['PJSUA_RTP_PORT_START'] = '10000'
os.environ['PJSUA_RTP_PORT_RANGE'] = '10000'
```
**Status:** Unlikely to work (PJSIP doesn't read these)

### 2. Low-level C API (lines 1096-1129)
```python
import pjsua  # C API
med_cfg = pjsua.media_config_default()
med_cfg.port = 10000
pjsua.reconfigure_media(med_cfg)
```
**Status:** May work if `pjsua` module is available

### 3. Alternative Attribute Names (lines 1167-1188)
```python
media_cfg.rtpStart = 10000  # Try different names
media_cfg.portRange = 10000
```
**Status:** Depends on PJSUA2 version

## Definitive Solutions

### Option A: Docker Environment Variables

Add to `docker-compose.yml`:
```yaml
backend:
  environment:
    PJSUA_RTP_PORT_START: "10000"
    PJSUA_RTP_PORT_RANGE: "10000"
```
**Likelihood:** Low (PJSIP probably doesn't read these)

### Option B: Recompile PJSIP with Custom Defaults

Modify PJSIP source before compilation:
```c
// In pjsua_media.c
#define PJSUA_RTP_PORT_START 10000  // Change from 4000
```

Then rebuild pjsua2:
```bash
# In PJSIP source directory
./configure --enable-shared
make dep && make
make install
pip install --force-reinstall --no-cache pjsua2
```

**Likelihood:** High success rate, but requires custom build

### Option C: Use pjsua.conf File

Create `/etc/pjsua.conf` or `~/.pjsua.conf`:
```
--rtp-port 10000
--rtp-port-range 10000
```

Then load it:
```python
# Before libInit
self._ep.libLoadConfig("/etc/pjsua.conf")
```

**Likelihood:** Medium (if PJSUA2 supports config files)

### Option D: Patch PJSUA2 Python Bindings

Create a monkey patch:
```python
# After libCreate, before libInit
import ctypes
lib = ctypes.CDLL("libpjsua.so")
lib.pjsua_media_config_default.restype = ctypes.c_void_p
cfg_ptr = lib.pjsua_media_config_default()
# Modify cfg_ptr directly in memory
ctypes.cast(cfg_ptr + offset, ctypes.POINTER(ctypes.c_uint16)).contents.value = 10000
```

**Likelihood:** High, but very fragile

### Option E: Use Different PJSUA2 Version

Try older/newer PJSUA2 version:
```bash
pip install pjsua2==2.10  # or 2.11, 2.12, etc.
```

Some versions may have working Python bindings.

## Verification

After applying any solution, check logs for:
```
✅ DIAGNOSTIC: PJSUA ports RTP RÉELS après libStart(): start=10000, range=10000
```

And verify with:
```bash
netstat -uln | grep :10000
# Should show PJSUA listening on 10000-20000, not 4000
```

## Impact if Not Fixed

Using port 4000 instead of 10000:
- May conflict with other services
- FreePBX compatibility issues (expects 10000-20000)
- Rapid call cycling may exhaust small port range (100 ports vs 10000)

## Temporary Mitigation

If we can't fix the port, we can:
1. Ensure no other service uses ports 4000-4100
2. Configure FreePBX to send RTP to 4000-4100
3. Reduce `rtp_port_range` expectations

## Status

**Current:** Workarounds implemented, waiting for testing results.

**Next Steps:**
1. Test if any workaround succeeds
2. If none work, use Option B (recompile PJSIP)
3. Report bug to PJSUA2 Python maintainers

## References

- PJSIP source: https://github.com/pjsip/pjproject
- PJSUA2 docs: https://docs.pjsip.org/en/latest/api/pjsua2.html
- Default port definition: `pjsua_media.c:PJSUA_RTP_PORT_START`
