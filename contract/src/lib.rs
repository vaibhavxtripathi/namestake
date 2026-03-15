#![no_std]
use soroban_sdk::{
    contract, contractimpl, contracttype, symbol_short,
    Address, Env, String, Vec, token,
};

// ── Constants ──────────────────────────────────────────────────────────────
const CLAIM_FEE:    i128 = 5_000_000;  // 0.5 XLM to claim
const TRANSFER_FEE: i128 = 2_000_000;  // 0.2 XLM to transfer
const MAX_NAME_LEN: u32  = 20;
const MIN_NAME_LEN: u32  = 3;

#[contracttype]
#[derive(Clone)]
pub struct NameRecord {
    pub name:       String,
    pub owner:      Address,
    pub claimed_at: u64,
    pub transferred: u32,   // number of times transferred
}

#[contracttype]
pub enum DataKey {
    Name(String),          // name → NameRecord
    OwnerNames(Address),   // address → Vec<String> of names owned
    TotalNames,
    Treasury,              // accumulated fees address
}

fn is_valid_char(c: u8) -> bool {
    // a–z, 0–9, hyphen
    matches!(c, b'a'..=b'z' | b'0'..=b'9' | b'-')
}

fn validate_name(name: &String) -> bool {
    let len = name.len();
    if len < MIN_NAME_LEN || len > MAX_NAME_LEN {
        return false;
    }
    let bytes = name.as_bytes();
    // No leading/trailing hyphens
    if bytes[0] == b'-' || bytes[(len - 1) as usize] == b'-' {
        return false;
    }
    bytes.iter().all(|&c| is_valid_char(c))
}

#[contract]
pub struct NameStakeContract;

#[contractimpl]
impl NameStakeContract {
    /// Claim a name — pay the fee, name must be free
    pub fn claim(
        env: Env,
        claimer: Address,
        name: String,
        xlm_token: Address,
    ) {
        claimer.require_auth();
        assert!(validate_name(&name), "Invalid name: 3–20 chars, a-z 0-9 hyphen only");

        let name_key = DataKey::Name(name.clone());
        assert!(
            !env.storage().persistent().has(&name_key),
            "Name already taken"
        );

        let token_client = token::Client::new(&env, &xlm_token);
        token_client.transfer(&claimer, &env.current_contract_address(), &CLAIM_FEE);

        let record = NameRecord {
            name: name.clone(),
            owner: claimer.clone(),
            claimed_at: env.ledger().timestamp(),
            transferred: 0,
        };

        env.storage().persistent().set(&name_key, &record);

        // Track owner's names
        let mut owner_names: Vec<String> = env
            .storage().persistent()
            .get(&DataKey::OwnerNames(claimer.clone()))
            .unwrap_or(Vec::new(&env));
        owner_names.push_back(name.clone());
        env.storage().persistent().set(&DataKey::OwnerNames(claimer), &owner_names);

        let total: u32 = env.storage().instance()
            .get(&DataKey::TotalNames).unwrap_or(0u32);
        env.storage().instance().set(&DataKey::TotalNames, &(total + 1));

        env.events().publish((symbol_short!("claimed"),), (name, claimer));
    }

    /// Transfer a name to a new owner — pays a fee
    pub fn transfer(
        env: Env,
        from: Address,
        to: Address,
        name: String,
        xlm_token: Address,
    ) {
        from.require_auth();

        let name_key = DataKey::Name(name.clone());
        let mut record: NameRecord = env.storage().persistent()
            .get(&name_key).expect("Name not found");

        assert!(record.owner == from, "Not the name owner");
        assert!(from != to, "Cannot transfer to yourself");

        let token_client = token::Client::new(&env, &xlm_token);
        token_client.transfer(&from, &env.current_contract_address(), &TRANSFER_FEE);

        // Remove from old owner list
        let mut from_names: Vec<String> = env
            .storage().persistent()
            .get(&DataKey::OwnerNames(from.clone()))
            .unwrap_or(Vec::new(&env));
        for i in 0..from_names.len() {
            if from_names.get(i).unwrap() == name {
                from_names.remove(i);
                break;
            }
        }
        env.storage().persistent().set(&DataKey::OwnerNames(from), &from_names);

        // Add to new owner list
        let mut to_names: Vec<String> = env
            .storage().persistent()
            .get(&DataKey::OwnerNames(to.clone()))
            .unwrap_or(Vec::new(&env));
        to_names.push_back(name.clone());
        env.storage().persistent().set(&DataKey::OwnerNames(to.clone()), &to_names);

        record.owner = to.clone();
        record.transferred += 1;
        env.storage().persistent().set(&name_key, &record);

        env.events().publish((symbol_short!("transfd"),), (name, from, to));
    }

    /// Release a name back to the pool (no refund)
    pub fn release(env: Env, owner: Address, name: String) {
        owner.require_auth();

        let name_key = DataKey::Name(name.clone());
        let record: NameRecord = env.storage().persistent()
            .get(&name_key).expect("Name not found");

        assert!(record.owner == owner, "Not the name owner");

        env.storage().persistent().remove(&name_key);

        let mut owner_names: Vec<String> = env
            .storage().persistent()
            .get(&DataKey::OwnerNames(owner.clone()))
            .unwrap_or(Vec::new(&env));
        for i in 0..owner_names.len() {
            if owner_names.get(i).unwrap() == name {
                owner_names.remove(i);
                break;
            }
        }
        env.storage().persistent().set(&DataKey::OwnerNames(owner), &owner_names);

        let total: u32 = env.storage().instance()
            .get(&DataKey::TotalNames).unwrap_or(1u32);
        env.storage().instance().set(&DataKey::TotalNames, &total.saturating_sub(1));

        env.events().publish((symbol_short!("released"),), (name,));
    }

    // ── Reads ──────────────────────────────────────────────────────────────
    pub fn lookup(env: Env, name: String) -> Option<NameRecord> {
        env.storage().persistent().get(&DataKey::Name(name))
    }

    pub fn reverse_lookup(env: Env, owner: Address) -> Vec<String> {
        env.storage().persistent()
            .get(&DataKey::OwnerNames(owner))
            .unwrap_or(Vec::new(&env))
    }

    pub fn is_available(env: Env, name: String) -> bool {
        if !validate_name(&name) { return false; }
        !env.storage().persistent().has(&DataKey::Name(name))
    }

    pub fn total_names(env: Env) -> u32 {
        env.storage().instance().get(&DataKey::TotalNames).unwrap_or(0u32)
    }

    pub fn claim_fee(_env: Env) -> i128 { CLAIM_FEE }
    pub fn transfer_fee(_env: Env) -> i128 { TRANSFER_FEE }
}
