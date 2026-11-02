# BBC iPlayer launch investigation

The owner read the installed BBC iPlayer 1.1.59 manifest from their LS03F. It identifies `DqEoaplKlw.bbchybrid` and explicitly registers `http://samsung.com/appcontrol/operation/eden_resume`.

CleanFrame now targets that exact application ID using the registered operation through Tizen's application-control API. This does not alter iPlayer, use a network bridge, or require Vetro/root. Its success on the physical TV is not yet established: a launch callback is not proof that iPlayer is visibly running.

The generic application launch and default app-control operation previously returned to Samsung Home. The next test is to rebuild/install CleanFrame, launch BBC iPlayer and observe the screen. If it fails, capture app-control errors and launch logs to determine whether caller permissions or additional launch data are required. The manifest also lists an HbbTV link, but that alone does not establish how a third-party launcher should invoke it.

The earlier temporary bridge scripts are retained only as experimental source; they are not called by CleanFrame and do not need to be started. The separate `vetro-tv-only-iplayer` branch contains the alternative custom-Vetro approach. Do not install that approach for this test.
