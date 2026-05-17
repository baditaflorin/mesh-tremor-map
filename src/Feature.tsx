import { useEffect, useState } from "react";
import {
  MeshNameInput,
  useRateLimit,
  useShake,
  type MeshConfig,
  type YRoom,
} from "@baditaflorin/mesh-common";

type Props = { room: YRoom | null; config: MeshConfig };

type Reading = {
  /** Smoothed accel magnitude (m/s² above 1g). Higher = more motion. */
  jitter: number;
  /** "still" / "walking" / "running" / "shaking" — derived label. */
  state: string;
  name: string;
  armed: boolean;
};

const NAME_KEY = (prefix: string) => `${prefix}:displayName`;

function labelFor(jitter: number): string {
  if (jitter < 0.3) return "still";
  if (jitter < 1.5) return "walking";
  if (jitter < 4) return "running";
  return "shaking";
}

export function Feature({ room, config }: Props) {
  if (!room) {
    return (
      <div className="tr-screen">
        <h1>tremor map</h1>
        <p className="tr-status">Connecting…</p>
      </div>
    );
  }
  return <Body room={room} config={config} />;
}

function Body({ room, config }: { room: YRoom; config: MeshConfig }) {
  const [name, setName] = useState(
    () => localStorage.getItem(NAME_KEY(config.storagePrefix)) ?? "",
  );
  const [armed, setArmed] = useState(false);
  const shake = useShake({ armed, threshold: 6 });
  const permError = shake.error;
  const myJitter = armed ? shake.magnitude : 0;
  const [, rerender] = useState(0);
  const pubLimit = useRateLimit({ max: 1, perMs: 300 });

  useEffect(() => {
    if (name) localStorage.setItem(NAME_KEY(config.storagePrefix), name);
  }, [name, config.storagePrefix]);

  useEffect(() => {
    const yReadings = room.doc.getMap<Reading>("readings");
    const onChange = () => rerender((n) => n + 1);
    yReadings.observe(onChange);
    return () => yReadings.unobserve(onChange);
  }, [room]);

  // Publish disarmed state.
  useEffect(() => {
    if (armed) return;
    const myName = name.trim() || `peer-${room.peerId.slice(0, 4)}`;
    room.doc.getMap<Reading>("readings").set(room.peerId, {
      jitter: 0,
      state: "off",
      name: myName,
      armed: false,
    });
  }, [armed, name, room]);

  // Publish armed jitter (throttled to ~300ms).
  useEffect(() => {
    if (!armed) return;
    if (!pubLimit.take()) return;
    const myName = name.trim() || `peer-${room.peerId.slice(0, 4)}`;
    room.doc.getMap<Reading>("readings").set(room.peerId, {
      jitter: Math.round(myJitter * 100) / 100,
      state: labelFor(myJitter),
      name: myName,
      armed: true,
    });
  }, [armed, name, room, myJitter, pubLimit]);

  const readings: Array<{ id: string; r: Reading }> = [];
  room.doc.getMap<Reading>("readings").forEach((r, id) => readings.push({ id, r }));
  readings.sort((a, b) => b.r.jitter - a.r.jitter);
  const armedReadings = readings.filter((r) => r.r.armed);

  return (
    <div className="tr-screen">
      <header className="tr-header">
        <h1>tremor map</h1>
        <MeshNameInput
          value={name}
          onChange={setName}
          placeholder="your name (optional)"
          maxLength={32}
          className="tr-name"
        />
      </header>

      {!armed && (
        <>
          <button type="button" className="tr-arm" onClick={() => setArmed(true)}>
            arm accelerometer
          </button>
          {permError && <p className="tr-error">{permError}</p>}
          <p className="tr-help">
            iOS requires a tap to enable motion. Once armed, your phone publishes a rolling-stddev
            jitter score to the mesh every 300 ms.
          </p>
        </>
      )}

      {armed && (
        <>
          <p className="tr-armed">
            you · <strong>{labelFor(myJitter)}</strong> · jitter={" "}
            {(Math.round(myJitter * 100) / 100).toFixed(2)}
          </p>
          <button type="button" className="tr-disarm" onClick={() => setArmed(false)}>
            disarm
          </button>
        </>
      )}

      <div className="tr-summary">
        <p>
          {armedReadings.length} armed · {readings.length - armedReadings.length} off
        </p>
      </div>

      <ul className="tr-list">
        {readings.length === 0 && <li className="tr-empty">no peers yet</li>}
        {readings.map(({ id, r }) => (
          <li key={id} className={`tr-peer tr-state-${r.state} ${r.armed ? "" : "is-idle"}`}>
            <span className="tr-peer-name">{r.name}</span>
            <span className="tr-peer-state">{r.state}</span>
            <span className="tr-peer-val">{r.armed ? r.jitter.toFixed(2) : "—"}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
