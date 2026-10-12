# Private conversion environment (B). Build on a machine you control; mount the game read-only.
#   docker build -t cws-convert -f tools/gta/service/Dockerfile .
#   docker run --rm -p 127.0.0.1:8787:8787 -e CONVERT_TOKEN=… -v /path/to/GTAV:/game:ro -v cws-jobs:/jobs cws-convert
# Not verified in the authoring session (Blender downloads were not reachable there); every other step was.
FROM ubuntu:24.04
ARG BLENDER_VERSION=4.2.3
ARG SOLLUMZ_REV=75d323e90f2c5f4ee0be20a991599fac3e951e82
RUN apt-get update && DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends \
      dotnet-sdk-8.0 nodejs npm git curl xz-utils ca-certificates libxi6 libxxf86vm1 libxfixes3 libxrender1 libgl1 libxkbcommon0 libsm6 \
    && rm -rf /var/lib/apt/lists/*
RUN curl -fsSL https://download.blender.org/release/Blender${BLENDER_VERSION%.*}/blender-${BLENDER_VERSION}-linux-x64.tar.xz | tar -xJ -C /opt \
    && ln -s /opt/blender-${BLENDER_VERSION}-linux-x64/blender /usr/local/bin/blender
# Sollumz (GPL-3.0) as a Blender extension, pinned; its required szio dependency is installed by Sollumz itself
RUN git clone https://github.com/Sollumz/Sollumz /opt/sollumz && git -C /opt/sollumz checkout ${SOLLUMZ_REV} \
    && mkdir -p /root/.config/blender/${BLENDER_VERSION%.*}/scripts/addons && ln -s /opt/sollumz /root/.config/blender/${BLENDER_VERSION%.*}/scripts/addons/sollumz \
    && blender --background --factory-startup --python-expr "import addon_utils; addon_utils.enable('sollumz', default_set=True); import bpy; bpy.ops.wm.save_userpref()" || true
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts
COPY . .
RUN tools/gta/fetch-codewalker.sh && dotnet build -c Release tools/gta/cw-extract
ENV GAME_DIR=/game JOBS_DIR=/jobs HOST=0.0.0.0 PORT=8787
EXPOSE 8787
CMD ["node", "tools/gta/service/server.mjs"]
