import { createMeshConfig } from "@baditaflorin/mesh-common";

export const config = createMeshConfig({
  appName: "mesh-tremor-map",
  description:
    "Live map of who's walking and who's still — accel jitter aggregated across the mesh",
  accentHex: "#e056fd",
  version: __APP_VERSION__,
  commit: __GIT_COMMIT__,
});
