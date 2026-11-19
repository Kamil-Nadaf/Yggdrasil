cask "yggdrasil" do
  version "0.5.8"

  on_arm do
    sha256 "c5b21b2cb87b960bfbc2bfcfce7e6b785b4d65035c1ae6c703387ee5ab717b24"
    url "https://github.com/Kamil-Nadaf/Yggdrasil/releases/download/v0.5.8/Yggdrasil-20261119-mac-arm64.dmg"
  end

  on_intel do
    sha256 "c6c7e96505d41551e1ede083f1bcc8f3bb4a70458b5c16788ca8dd868a82b187"
    url "https://github.com/Kamil-Nadaf/Yggdrasil/releases/download/v0.5.8/Yggdrasil-20261119-mac-intel.dmg"
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
