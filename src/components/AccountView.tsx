import { useState } from "react";
import { AlertCircle, CheckCircle2, KeyRound, Loader2, LogOut, Shield, ShieldAlert } from "lucide-react";
import { api, clearApiBaseUrl, getApiBaseUrl, probeApiBaseUrl, setApiBaseUrl } from "../api";
import type { BootstrapState } from "../types";

interface AccountViewProps {
  state: BootstrapState;
  onStateChange: (next: BootstrapState) => void;
  onSignedOut: () => void;
  onServerChanged?: () => void;
}

export function AccountView({ state, onStateChange, onSignedOut, onServerChanged }: AccountViewProps) {
  const { user, security } = state;

  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [changingPw, setChangingPw] = useState(false);
  const [pwSuccess, setPwSuccess] = useState("");
  const [errorMsg, setErrorMsg] = useState("");

  const [sessionBusy, setSessionBusy] = useState(false);
  const [sessionNotice, setSessionNotice] = useState("");
  const [activeSessions, setActiveSessions] = useState(security.activeSessionsCount);
  const [updatingLock, setUpdatingLock] = useState(false);
  const [editingEndpoint, setEditingEndpoint] = useState(false);
  const [endpointInput, setEndpointInput] = useState(() => getApiBaseUrl());
  const [checkingEndpoint, setCheckingEndpoint] = useState(false);

  async function handleChangePassword(e: React.FormEvent) {
    e.preventDefault();
    setErrorMsg("");
    setPwSuccess("");

    if (newPassword.length < 8) {
      setErrorMsg("New password must be at least 8 characters long.");
      return;
    }
    if (newPassword !== confirmPassword) {
      setErrorMsg("New passwords do not match.");
      return;
    }

    setChangingPw(true);
    try {
      const res = await api.changePassword(currentPassword, newPassword);
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      setActiveSessions(res.activeSessionsCount);
      setPwSuccess(
        res.revokedOthers > 0
          ? `Password updated and ${res.revokedOthers} other session(s) revoked.`
          : "Password updated successfully."
      );
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : "Failed to update password");
    } finally {
      setChangingPw(false);
    }
  }

  async function handleLogoutOthers() {
    setSessionBusy(true);
    setErrorMsg("");
    setSessionNotice("");
    try {
      const res = await api.logoutAll(false);
      setActiveSessions(res.activeSessionsCount);
      setSessionNotice(
        res.revoked > 0
          ? `Signed out ${res.revoked} other active session(s).`
          : "No other active sessions found."
      );
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : "Failed to revoke sessions");
    } finally {
      setSessionBusy(false);
    }
  }

  async function handleLogoutEverywhere() {
    setSessionBusy(true);
    setErrorMsg("");
    try {
      await api.logoutAll(true);
      await api.logout();
      onSignedOut();
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : "Failed to sign out everywhere");
      setSessionBusy(false);
    }
  }

  async function handleToggleSignups(allow: boolean) {
    setUpdatingLock(true);
    setErrorMsg("");
    try {
      const res = await api.updateSecuritySettings(allow);
      onStateChange(res.state);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : "Failed to update access policy");
    } finally {
      setUpdatingLock(false);
    }
  }

  const createdStr = new Date(user.created_at * 1000).toISOString().slice(0, 16).replace("T", " ");
  const lastLoginStr = new Date(user.last_login_at * 1000).toISOString().slice(0, 16).replace("T", " ");

  return (
    <div className="space-y-6">
      {errorMsg && (
        <div className="flex items-start gap-2.5 bg-red-50 border border-red-200 text-red-800 px-4 py-3 rounded-xl text-sm">
          <AlertCircle className="w-4 h-4 mt-0.5 shrink-0 text-red-600" />
          <span>{errorMsg}</span>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-start">
        {/* Account Overview & Active Sessions */}
        <section className="bg-white border border-slate-200 rounded-xl p-5 sm:p-6 space-y-5">
          <div className="flex items-center justify-between pb-3 border-b border-slate-100">
            <div>
              <h2 className="text-base font-semibold text-slate-900">Authenticated Account</h2>
              <p className="text-xs text-slate-500 mt-0.5">
                All sites, API keys, generated thumbnails, and ledger history are scoped strictly to this account.
              </p>
            </div>
            <Shield className="w-5 h-5 text-blue-600 shrink-0" />
          </div>

          <dl className="divide-y divide-slate-100 text-sm">
            <div className="py-2.5 flex items-center justify-between gap-4">
              <dt className="text-slate-500 text-xs">Name</dt>
              <dd className="font-medium text-slate-900">{user.name}</dd>
            </div>
            <div className="py-2.5 flex items-center justify-between gap-4">
              <dt className="text-slate-500 text-xs">Email</dt>
              <dd className="font-mono text-xs text-slate-800">{user.email}</dd>
            </div>
            <div className="py-2.5 flex items-center justify-between gap-4">
              <dt className="text-slate-500 text-xs">Role</dt>
              <dd className="font-medium text-slate-900 capitalize">{user.role}</dd>
            </div>
            <div className="py-2.5 flex items-center justify-between gap-4">
              <dt className="text-slate-500 text-xs">Active Sessions</dt>
              <dd className="font-mono tabular-nums text-slate-900 font-medium">{activeSessions}</dd>
            </div>
            <div className="py-2.5 flex items-center justify-between gap-4">
              <dt className="text-slate-500 text-xs">Last Sign-In (UTC)</dt>
              <dd className="font-mono tabular-nums text-xs text-slate-600">{lastLoginStr}</dd>
            </div>
            <div className="py-2.5 flex items-center justify-between gap-4">
              <dt className="text-slate-500 text-xs">Account Created (UTC)</dt>
              <dd className="font-mono tabular-nums text-xs text-slate-600">{createdStr}</dd>
            </div>
            <div className="py-2.5 flex items-center justify-between gap-4">
              <dt className="text-slate-500 text-xs">Backend API Endpoint</dt>
              <dd className="flex items-center gap-2 text-xs">
                <span className="font-mono text-slate-700 truncate max-w-[200px]">
                  {getApiBaseUrl() || "Same-origin (/api)"}
                </span>
                <button
                  type="button"
                  onClick={() => {
                    setEndpointInput(getApiBaseUrl());
                    setEditingEndpoint((v) => !v);
                  }}
                  className="text-blue-600 hover:text-blue-800 font-medium cursor-pointer shrink-0"
                >
                  {editingEndpoint ? "Cancel" : "Change"}
                </button>
              </dd>
            </div>
          </dl>

          {editingEndpoint && (
            <form
              onSubmit={async (e) => {
                e.preventDefault();
                setErrorMsg("");
                if (!endpointInput.trim()) {
                  clearApiBaseUrl();
                  setEditingEndpoint(false);
                  onServerChanged?.();
                  return;
                }
                setCheckingEndpoint(true);
                try {
                  const { url } = await probeApiBaseUrl(endpointInput);
                  setApiBaseUrl(url);
                  setEndpointInput(url);
                  setEditingEndpoint(false);
                  onServerChanged?.();
                } catch (err) {
                  setErrorMsg(err instanceof Error ? err.message : "Could not reach backend URL");
                } finally {
                  setCheckingEndpoint(false);
                }
              }}
              className="flex flex-wrap items-center gap-2 pt-1"
            >
              <input
                type="text"
                value={endpointInput}
                onChange={(e) => setEndpointInput(e.target.value)}
                placeholder="https://your-autopost-server.run.app or localhost:3000"
                className="flex-1 min-w-[200px] h-9 px-3 text-xs font-mono bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              <button
                type="submit"
                disabled={checkingEndpoint}
                className="inline-flex items-center gap-1.5 h-9 px-3 text-xs font-medium text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-50 rounded-lg cursor-pointer"
              >
                {checkingEndpoint && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                <span>{checkingEndpoint ? "Verifying..." : "Verify & Save"}</span>
              </button>
              <button
                type="button"
                disabled={checkingEndpoint}
                onClick={() => {
                  clearApiBaseUrl();
                  setEndpointInput("");
                  setEditingEndpoint(false);
                  onServerChanged?.();
                }}
                className="h-9 px-3 text-xs font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 disabled:opacity-50 rounded-lg cursor-pointer"
              >
                Same-Origin
              </button>
            </form>
          )}

          {sessionNotice && (
            <div className="flex items-center gap-2 text-xs font-medium text-emerald-700 bg-emerald-50 border border-emerald-200 px-3 py-2 rounded-lg">
              <CheckCircle2 className="w-4 h-4 shrink-0" />
              <span>{sessionNotice}</span>
            </div>
          )}

          <div className="pt-2 flex flex-wrap items-center gap-2.5">
            <button
              type="button"
              onClick={handleLogoutOthers}
              disabled={sessionBusy}
              className="h-9 px-3.5 text-xs font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 disabled:opacity-50 rounded-lg transition-colors whitespace-nowrap cursor-pointer"
            >
              Sign Out Other Devices
            </button>
            <button
              type="button"
              onClick={handleLogoutEverywhere}
              disabled={sessionBusy}
              className="inline-flex items-center gap-1.5 h-9 px-3.5 text-xs font-medium text-red-700 bg-red-50 hover:bg-red-100 disabled:opacity-50 rounded-lg transition-colors whitespace-nowrap cursor-pointer"
            >
              <LogOut className="w-3.5 h-3.5" />
              <span>Sign Out All Devices</span>
            </button>
          </div>
        </section>

        {/* Change Password */}
        <form
          onSubmit={handleChangePassword}
          className="bg-white border border-slate-200 rounded-xl p-5 sm:p-6 space-y-4"
        >
          <div className="flex items-center justify-between pb-3 border-b border-slate-100">
            <div>
              <h2 className="text-base font-semibold text-slate-900">Change Password</h2>
              <p className="text-xs text-slate-500 mt-0.5">
                Updating your password automatically revokes all other signed-in sessions.
              </p>
            </div>
            <KeyRound className="w-5 h-5 text-slate-400 shrink-0" />
          </div>

          {pwSuccess && (
            <div className="flex items-center gap-2 text-xs font-medium text-emerald-700 bg-emerald-50 border border-emerald-200 px-3 py-2 rounded-lg">
              <CheckCircle2 className="w-4 h-4 shrink-0" />
              <span>{pwSuccess}</span>
            </div>
          )}

          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">Current Password</label>
            <input
              type="password"
              required
              autoComplete="current-password"
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
              className="w-full h-9 px-3 text-sm bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">
              New Password (minimum 8 characters)
            </label>
            <input
              type="password"
              required
              autoComplete="new-password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              className="w-full h-9 px-3 text-sm bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">Confirm New Password</label>
            <input
              type="password"
              required
              autoComplete="new-password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              className="w-full h-9 px-3 text-sm bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          <div className="pt-2 flex justify-end">
            <button
              type="submit"
              disabled={changingPw}
              className="inline-flex items-center gap-2 h-9 px-4 text-xs font-medium text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-50 rounded-lg transition-colors cursor-pointer"
            >
              {changingPw && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
              <span>Update Password</span>
            </button>
          </div>
        </form>
      </div>

      {/* Admin Access Control */}
      {user.role === "admin" && (
        <section className="bg-white border border-slate-200 rounded-xl p-5 sm:p-6 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <ShieldAlert className="w-4 h-4 text-slate-700 shrink-0" />
              <h2 className="text-base font-semibold text-slate-900">Site Registration Lock</h2>
            </div>
            <p className="text-xs text-slate-500 max-w-2xl">
              Control whether new users can create accounts on the login screen. Lock signups once your team accounts are set up. Currently registered accounts:{" "}
              <span className="font-mono tabular-nums font-semibold text-slate-700">
                {security.totalUsers ?? 1}
              </span>
              .
            </p>
          </div>

          <div className="flex items-center gap-3 shrink-0">
            <span
              className={`text-xs font-medium ${
                security.allowSignups ? "text-amber-700" : "text-emerald-700"
              }`}
            >
              {security.allowSignups ? "Public Signups Open" : "Signups Locked"}
            </span>
            <button
              type="button"
              disabled={updatingLock}
              onClick={() => handleToggleSignups(!security.allowSignups)}
              className={`h-9 px-4 text-xs font-medium rounded-lg transition-colors whitespace-nowrap cursor-pointer disabled:opacity-50 ${
                security.allowSignups
                  ? "bg-slate-900 text-white hover:bg-slate-800"
                  : "bg-slate-100 text-slate-700 hover:bg-slate-200"
              }`}
            >
              {security.allowSignups ? "Lock New Signups" : "Allow New Signups"}
            </button>
          </div>
        </section>
      )}
    </div>
  );
}
