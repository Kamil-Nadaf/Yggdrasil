cask "yggdrasil" do
  version "0.5.4"

  on_arm do
    sha256 "6d231becfe5d2575c00ef4fef71123b773ea5ac4ccd041fe675301402e0caa38"
    url "https://github.com/Kamil-Nadaf/Yggdrasil/releases/download/v0.5.4/Yggdrasil-20261118-mac-arm64.dmg"
  end

  on_intel do
    sha256 "fc8fd4bd2552ee66d3c571d4c12d8ac160978d0c881901392a8661377f4df089"
    url "https://github.com/Kamil-Nadaf/Yggdrasil/releases/download/v0.5.4/Yggdrasil-20261118-mac-intel.dmg"
  end

  name "Yggdrasil"
  desc "Self-hosted research app: read arXiv papers, notes, LaTeX, slides"
  homepage "https://github.com/Kamil-Nadaf/Yggdrasil"

  livecheck do
    url :url
    strategy :github_latest
  end

  # The app is not code-signed; drop the quarantine flag so it opens without the Gatekeeper dialog.
  app "Yggdrasil.app"
  postflight do
    system_command "/usr/bin/xattr", args: ["-dr", "com.apple.quarantine", "#{appdir}/Yggdrasil.app"]
  end
end
