#[cfg(windows)]
mod helper;
#[cfg(windows)]
mod observe;
mod protocol;
#[cfg(windows)]
mod win;

fn main() {
    #[cfg(windows)]
    {
        let args: Vec<_> = std::env::args().skip(1).collect();
        let result = match args.as_slice() {
            [mode, evidence, parent] if mode == "observe" => observe::run(evidence, parent),
            [mode, evidence, parent, nonce] if mode == "prepare" => {
                observe::prepare(evidence, parent, nonce)
            }
            [mode, root, nonce] if ["set", "read"].contains(&mode.as_str()) => {
                helper::run(root, nonce, mode)
            }
            _ => Err(
                "usage: observe <fresh-absolute-evidence-dir> <existing-absolute-parent> | set/read <owned-root> <nonce>"
                    .into(),
            ),
        };
        if let Err(error) = result {
            eprintln!(
                "TASK0_FAILURE: {}",
                error.chars().take(1024).collect::<String>()
            );
            std::process::exit(1);
        }
    }
    #[cfg(not(windows))]
    {
        eprintln!("Task0 requires Windows; no observation was performed");
        std::process::exit(1);
    }
}
