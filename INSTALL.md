# How to install IRO

**You need DaVinci Resolve Studio 18 or later.** Workflow Integration panels are a Studio feature, so the free edition of Resolve can't open the panel.

## Mac

1. Close DaVinci Resolve.
2. Double-click **IRO-1.0.0.pkg**. macOS says it "can't verify" the installer, because it isn't from the App Store or a paid Apple developer account. Click **Done**, not Move to Trash.
3. Open **System Settings › Privacy & Security** and scroll down to **Security**. Next to *"IRO-1.0.0.pkg" was blocked*, click **Open Anyway**, then enter your Mac password.
4. The installer opens. Click through it. It asks for your password once, to put the panel in Resolve's plugin folder.
5. Open Resolve and choose **Workspace › Workflow Integrations › IRO**, then pick your sound folders.

You only do step 3 once. If you don't see **Open Anyway**, try opening the installer again first: the button appears for about an hour after macOS blocks a file.

**To remove it:** run **Uninstall IRO.command** (the same Open Anyway step applies), or delete
`/Library/Application Support/Blackmagic Design/DaVinci Resolve/Workflow Integration Plugins/com.thiseniola.iro`.

## Windows (not tested yet)

Run the Setup .exe. If Windows shows *"Windows protected your PC"*, click **More info › Run anyway**.

## Is it safe?

The panel only reads the sound folders you pick. It doesn't upload anything, and it doesn't connect to the internet unless you click Donate.
