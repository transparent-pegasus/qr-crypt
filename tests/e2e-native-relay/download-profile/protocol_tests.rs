use super::*;

const NONCE: &str = "00112233445566778899aabbccddeeff";
const ID: &str = "NDL0\t1\t00112233445566778899aabbccddeeff\tset\tidentity\t17\t23\t433a5c785c70726f66696c65\t44656661756c74\t433a5c785c70726f66696c655c44656661756c74\t0\t3135362e30\n";

#[test]
fn receipt_identity_and_normal_exit_are_bound_to_nonce_mode_and_pids() {
    let mut r = Receipts::new(NONCE, "set", 17);
    assert_eq!(r.accept(ID).unwrap()[3], "Default");
    assert_eq!(r.next, 1);
    assert!(r.accept(ID).is_err(), "duplicate identity must not advance");
    for bad in [
        ID.replace(NONCE, "ffffffffffffffffffffffffffffffff"),
        ID.replace("\tset\t", "\tread\t"),
        ID.replace("\t17\t", "\t18\t"),
        ID.replace("\t0\t", "\t1\t"),
    ] {
        assert!(Receipts::new(NONCE, "set", 17).accept(&bad).is_err());
    }
    assert!(r.accept("NDL0\t1\t00112233445566778899aabbccddeeff\tset\tvalue\t17\t24\t433a5c785c646f776e6c6f616473\n").is_err());
    r.accept("NDL0\t1\t00112233445566778899aabbccddeeff\tset\tvalue\t17\t23\t433a5c785c646f776e6c6f616473\n").unwrap();
    r.accept("NDL0\t1\t00112233445566778899aabbccddeeff\tset\tclosed\t17\t23\n")
        .unwrap();
    assert!(
        r.accept(
            "NDL0\t1\t00112233445566778899aabbccddeeff\tset\tbrowser-exited\t17\t23\tabnormal\t12\n"
        )
        .is_err()
    );
    r.accept(
        "NDL0\t1\t00112233445566778899aabbccddeeff\tset\tbrowser-exited\t17\t23\tnormal\t12\n",
    )
    .unwrap();
    assert_eq!(r.next, 4);
    assert!(r.accept(ID).is_err());
}

#[test]
fn oversized_malformed_and_extra_fields_do_not_become_receipts() {
    for bad in [
        ID.trim_end().to_owned(),
        ID.replace("\t17\t", "\t017\t"),
        ID.replace("44656661756c74", "ff"),
        ID.replace("44656661756c74", "00"),
        ID.replace("\t0\t", "\textra\t0\t"),
        ID.replace("44656661756c74", &"61".repeat(129)),
        "a".repeat(8193),
    ] {
        assert!(Receipts::new(NONCE, "set", 17).accept(&bad).is_err());
    }
}

#[test]
fn ownership_rejects_sibling_prefixes_aliases_devices_and_reparse_spellings() {
    assert!(owned_path(
        r"C:\proof\profile",
        r"c:\proof\profile\Default",
        true
    ));
    assert!(owned_path(r"C:\proof\profile", r"C:\proof\profile", false));
    for other in [
        r"C:\proof\profile-other\Default",
        r"C:\proof\profile\..\outside",
        r"\\?\C:\proof\profile",
        r"C:\proof\profile\Default.",
        r"C:\proof\profile\NUL",
        r"C:\proof\profile\file:stream",
        r"C:\proof\profile\X~1",
    ] {
        assert!(!owned_path(r"C:\proof\profile", other, true), "{other}");
    }
    assert!(!owned_path(r"C:\proof\profile", r"C:\proof\profile", true));
}

#[test]
fn work_deadline_reserves_cleanup_and_each_wait_is_clipped() {
    assert_eq!(remaining(79_999, 15_000, false).unwrap(), 1);
    assert!(remaining(80_000, 1, false).is_err());
    assert_eq!(remaining(89_999, 10_000, true).unwrap(), 1);
    assert!(remaining(90_000, 1, true).is_err());
    assert_eq!(remaining(0, 5_000, false).unwrap(), 5_000);
}

#[test]
fn temp_parent_accepts_one_optional_final_backslash_without_other_changes() {
    for (raw, expected) in [
        (r"C:\Temp", r"C:\Temp"),
        (r"C:\Temp\", r"C:\Temp"),
        (
            r"d:\Users\Probe User\AppData\Local\Temp",
            r"d:\Users\Probe User\AppData\Local\Temp",
        ),
        (
            r"d:\Users\Probe User\AppData\Local\Temp\",
            r"d:\Users\Probe User\AppData\Local\Temp",
        ),
    ] {
        let prepared: Result<String, String> = prepare_temp_parent(raw);
        assert_eq!(prepared.unwrap(), expected, "{raw:?}");
    }
}

#[test]
fn temp_parent_keeps_rejecting_ambiguous_paths_with_or_without_a_final_backslash() {
    let oversized = format!("C:\\{}", "x".repeat(1022));
    for invalid in [
        "",
        "Temp",
        r"\Temp",
        "C:",
        "C:Temp",
        r"C:\",
        r"\\server\share\Temp",
        r"\\?\C:\Temp",
        r"\\.\C:\Temp",
        r"C:\Temp\.\child",
        r"C:\Temp\..\child",
        r"C:\Temp\.",
        r"C:\Temp\..",
        r"C:\Temp\\child",
        r"C:\Temp\\",
        r"C:\Temp.",
        r"C:\Temp.\child",
        r"C:\Temp ",
        r"C:\Temp \child",
        r"C:\Users\PROBE~1\Temp",
        r"C:\Temp\NUL",
        r"C:\Temp\con.txt",
        r"C:\Temp\COM1",
        r"C:\Temp\LPT9.log",
        r"C:\Temp:stream",
        "C:\\Temp\\bad\0",
        "C:\\Temp\\bad\tname",
        "C:\\Temp\\bad\nname",
        &oversized,
    ] {
        for raw in [invalid.to_owned(), format!("{invalid}\\")] {
            assert!(prepare_temp_parent(&raw).is_err(), "{raw:?}");
            assert!(!owned_path(&raw, &raw, false), "{raw:?}");
        }
    }
}

#[test]
fn general_owned_profile_and_download_paths_still_reject_final_backslashes() {
    for path in [r"C:\proof\profile", r"C:\proof\downloads"] {
        let with_separator = format!("{path}\\");
        assert!(owned_path(path, path, false));
        assert!(!owned_path(&with_separator, &with_separator, false));
        assert!(!owned_path(path, &with_separator, false));
        assert!(!owned_path(r"C:\proof", &with_separator, true));
    }
}

#[test]
fn identity_accepts_empty_profile_name_without_allowing_other_empty_fields() {
    assert!(unhex("", 128).is_err());
    for mode in ["set", "read"] {
        let identity = ID.replace("\tset\t", &format!("\t{mode}\t"));
        let fields: Vec<_> = identity.trim_end_matches('\n').split('\t').collect();
        for index in [7, 9, 11] {
            let mut empty = fields.clone();
            empty[index] = "";
            let mut receipts = Receipts::new(NONCE, mode, 17);
            assert!(
                receipts.accept(&format!("{}\n", empty.join("\t"))).is_err(),
                "{mode} empty identity field {index}"
            );
            assert_eq!(receipts.next, 0);
        }
        for name in [
            "f",
            "gg",
            "4A",
            "ff",
            "c0af",
            "00",
            "09",
            "0a",
            "7f",
            "c285",
            &"61".repeat(129),
        ] {
            let invalid = identity.replace("\t44656661756c74\t", &format!("\t{name}\t"));
            let mut receipts = Receipts::new(NONCE, mode, 17);
            assert!(receipts.accept(&invalid).is_err(), "{mode} name {name:?}");
            assert_eq!(receipts.next, 0);
        }
        let mut receipts = Receipts::new(NONCE, mode, 17);
        receipts.accept(&identity).unwrap();
        assert!(
            receipts
                .accept(&format!("NDL0\t1\t{NONCE}\t{mode}\tvalue\t17\t23\t\n"))
                .is_err(),
            "{mode} empty download value"
        );
        assert_eq!(receipts.next, 1);
    }
    for mode in ["set", "read"] {
        let identity = ID
            .replace("\tset\t", &format!("\t{mode}\t"))
            .replace("\t44656661756c74\t", "\t\t");
        let mut receipts = Receipts::new(NONCE, mode, 17);
        assert_eq!(
            receipts
                .accept(&identity)
                .expect("empty actual ProfileName must be accepted"),
            [
                "identity",
                "23",
                r"C:\x\profile",
                "",
                r"C:\x\profile\Default",
                "0",
                "156.0"
            ]
        );
        assert_eq!(receipts.next, 1);
    }
}
