; hooks.nsh — v69 (round 73): Sela POS installer hooks.
; ─────────────────────────────────────────────────────────────────
; Windows Firewall rules for the cashier LAN server (TCP 8950 +
; UDP 8951 + the app itself), allowed on ALL network profiles.
;
; WHY: the Tailscale adapter is classified by Windows as a "Public"
; network. The allow-rule from the first firewall prompt ("Allow
; access") usually covers Private networks only, so remote
; connections to the Tailscale IP (100.x.x.x) are silently dropped
; even when the port is "opened" manually. profile=any fixes LAN,
; VPN and Tailscale in one shot.
;
; ELEVATION: Tauri's default install mode is "currentUser", which
; runs the installer WITHOUT admin rights — netsh would fail. So we
; check the process token: elevated installers add the rules
; directly (cmd /c chains them); non-elevated ones spawn ONE
; elevated cmd (a single UAC prompt). If the user declines, install
; continues normally and the in-app "فتح المنفذ الآن" button in the
; Cashier screen remains as the fallback.
;
; Rule names MUST match the constants in src-tauri/src/commands.rs
; (FW_RULE_TCP / FW_RULE_UDP / FW_RULE_APP) so the in-app status
; check and the repair button see the same rules.
;
; NOTE: raw StrCmp/Goto + unique labels (no LogicLib dependency);
; each macro here is instantiated exactly once by the template, so
; label collisions cannot happen.

; The whole firewall chain, idempotent (deletes our named rules
; first, then re-adds them for all profiles). $INSTDIR is a runtime
; variable — it only evaluates when the instruction executes.
; ${MAINBINARYNAME} has no extension in Tauri's NSIS template —
; it is always used as ${MAINBINARYNAME}.exe there.
!define SELA_FW_CHAIN 'netsh advfirewall firewall delete rule name="Sela POS Cashier TCP" & netsh advfirewall firewall delete rule name="Sela POS Cashier UDP" & netsh advfirewall firewall delete rule name="Sela POS App" & netsh advfirewall firewall add rule name="Sela POS Cashier TCP" dir=in action=allow protocol=TCP localport=8950 profile=any & netsh advfirewall firewall add rule name="Sela POS Cashier UDP" dir=in action=allow protocol=UDP localport=8951 profile=any & netsh advfirewall firewall add rule name="Sela POS App" dir=in action=allow program="$INSTDIR\${MAINBINARYNAME}.exe" profile=any enable=yes'

!macro NSIS_HOOK_PREINSTALL
!macroend

!macro NSIS_HOOK_POSTINSTALL
  ; $R7/$R8 are rarely used by the Tauri template — still, we save
  ; and restore nothing because these run at the very end of the
  ; install section with no template code after the hook.
  UserInfo::GetAccountType
  Pop $R7
  StrCmp $R7 "Admin" sela_fw_elevated 0
    ; Non-elevated installer: ONE UAC prompt for the whole chain.
    ; Declining (e.g. exit code 1223) is non-fatal — the in-app
    ; repair button in the Cashier screen is the fallback.
    ExecShellWait "runas" "cmd" '/c ${SELA_FW_CHAIN}' SW_HIDE $R8
    Goto sela_fw_done
  sela_fw_elevated:
    nsExec::ExecToLog 'cmd /c ${SELA_FW_CHAIN}'
  sela_fw_done:
!macroend

!macro NSIS_HOOK_PREUNINSTALL
!macroend

!macro NSIS_HOOK_POSTUNINSTALL
  ; Leave the machine clean: remove our named firewall rules
  ; (best effort, elevation-aware like the install path).
  UserInfo::GetAccountType
  Pop $R7
  StrCmp $R7 "Admin" sela_un_fw_elevated 0
    ExecShellWait "runas" "cmd" '/c netsh advfirewall firewall delete rule name="Sela POS Cashier TCP" & netsh advfirewall firewall delete rule name="Sela POS Cashier UDP" & netsh advfirewall firewall delete rule name="Sela POS App"' SW_HIDE $R8
    Goto sela_un_fw_done
  sela_un_fw_elevated:
    nsExec::ExecToLog 'netsh advfirewall firewall delete rule name="Sela POS Cashier TCP"'
    nsExec::ExecToLog 'netsh advfirewall firewall delete rule name="Sela POS Cashier UDP"'
    nsExec::ExecToLog 'netsh advfirewall firewall delete rule name="Sela POS App"'
  sela_un_fw_done:
!macroend
