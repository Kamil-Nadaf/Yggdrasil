cask "yggdrasil" do
  version "0.5.7"

  on_arm do
    sha256 "18bd9e984293bd4083b6e6e4e1b80b48a1fbb8a54505fee1ae8a365c5ea41b01"
    url "https://github.com/Kamil-Nadaf/Yggdrasil/releases/download/v0.5.7/Yggdrasil-20261119-mac-arm64.dmg"
  end

  on_intel do
    sha256 "09153b6236b974e15aa56bb522a7330b96e9833d9bfae5768372d7092fd8943a"
    url "https://github.com/Kamil-Nadaf/Yggdrasil/releases/download/v0.5.7/Yggdrasil-20261119-mac-intel.dmg"
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
