// identity_graph.move - 链上身份与声誉合约
module identitygraph::reputation {
    use std::vector;
    use std::string;
    use std::signer;
    use aptos_framework::timestamp;
    use std::option;
    
    struct IdentityProfile has key {
        address: address,
        did_identifier: string::String, // Luffa DID
        verified_socials: vector<SocialAccount>,
        reputation_score: u64, // 0-1000分
        reputation_tier: u8, // 1-5级
        categories: vector<string::String>, // 身份标签：DeFi专家、NFT收藏家、DAO活跃者等
        verified_achievements: vector<Achievement>,
        last_updated: u64,
        trust_network: vector<address> // 信任网络（互相关注/合作地址）
    }
    
    struct SocialAccount has store {
        platform: string::String, // "luffa", "twitter", "github"
        username: string::String,
        verified_at: u64,
        verification_proof: string::String // 验证证明
    }
    
    struct Achievement has store {
        achievement_type: string::String, // "early_user", "nft_creator", "dao_governor"
        title: string::String,
        description: string::String,
        earned_at: u64,
        issuer: address, // 成就颁发者（合约地址或组织）
        proof_url: string::String
    }
    
    struct TrustConnection has key {
        from_address: address,
        to_address: address,
        connection_type: string::String, // "follow", "endorsement", "collaboration"
        strength: u8, // 1-10
        established_at: u64,
        last_interaction: u64,
        tags: vector<string::String>
    }
    
    struct ReputationEvent has store {
        event_type: string::String,
        address: address,
        impact_score: i64, // 正负影响分数
        description: string::String,
        timestamp: u64,
        verified_by: vector<address> // 验证者地址
    }
    
    // 初始化或更新身份档案
    public entry fun upsert_identity_profile(
        user: &signer,
        did_identifier: string::String,
        social_accounts: vector<SocialAccount>
    ) acquires IdentityProfile {
        let user_addr = signer::address_of(user);
        
        if (exists<IdentityProfile>(user_addr)) {
            let profile = borrow_global_mut<IdentityProfile>(user_addr);
            profile.did_identifier = did_identifier;
            profile.verified_socials = social_accounts;
            profile.last_updated = timestamp::now_seconds();
        } else {
            let initial_score = calculate_initial_reputation(user_addr);
            
            let profile = IdentityProfile {
                address: user_addr,
                did_identifier,
                verified_socials: social_accounts,
                reputation_score: initial_score,
                reputation_tier: calculate_tier(initial_score),
                categories: vector::empty<string::String>(),
                verified_achievements: vector::empty<Achievement>(),
                last_updated: timestamp::now_seconds(),
                trust_network: vector::empty<address>()
            };
            
            move_to(user, profile);
            
            // 自动授予早期用户成就
            if (timestamp::now_seconds() < 1735689600) { // 2025年之前
                grant_achievement(user_addr, "early_adopter", "Endless早期采用者");
            }
        }
        
        emit_event(IdentityUpdated {
            address: user_addr,
            did_identifier: copy did_identifier
        });
    }
    
    // 建立信任连接
    public entry fun establish_trust_connection(
        from_user: &signer,
        to_address: address,
        connection_type: string::String,
        strength: u8,
        tags: vector<string::String>
    ) acquires TrustConnection, IdentityProfile {
        let from_addr = signer::address_of(from_user);
        
        // 检查是否已存在连接
        let connection_id = generate_connection_id(from_addr, to_address);
        if (exists<TrustConnection>(connection_id)) {
            let connection = borrow_global_mut<TrustConnection>(connection_id);
            connection.strength = strength;
            connection.last_interaction = timestamp::now_seconds();
            connection.tags = tags;
        } else {
            let connection = TrustConnection {
                from_address: from_addr,
                to_address,
                connection_type,
                strength,
                established_at: timestamp::now_seconds(),
                last_interaction: timestamp::now_seconds(),
                tags
            };
            
            move_to(account::create_signer_for_address(from_addr), connection);
            
            // 更新双方的信任网络
            update_trust_network(from_addr, to_address);
        }
        
        // 记录声誉事件
        record_reputation_event(
            "trust_connection_established",
            from_addr,
            5, // 正面影响
            format!("与{}建立{}连接", to_address, connection_type)
        );
        
        emit_event(TrustConnectionEstablished {
            from_address: from_addr,
            to_address,
            connection_type: copy connection_type
        });
    }
    
    // 颁发成就
    public entry fun grant_achievement(
        issuer: &signer,
        recipient: address,
        achievement_type: string::String,
        title: string::String,
        description: string::String,
        proof_url: string::String
    ) acquires IdentityProfile {
        let issuer_addr = signer::address_of(issuer);
        
        // 验证颁发者权限（可以是合约、DAO或认证组织）
        assert!(can_grant_achievement(issuer_addr, achievement_type), EUNAUTHORIZED);
        
        assert!(exists<IdentityProfile>(recipient), EPROFILE_NOT_FOUND);
        let profile = borrow_global_mut<IdentityProfile>(recipient);
        
        let achievement = Achievement {
            achievement_type,
            title,
            description,
            earned_at: timestamp::now_seconds(),
            issuer: issuer_addr,
            proof_url
        };
        
        vector::push_back(&mut profile.verified_achievements, achievement);
        
        // 根据成就类型更新声誉分数
        let score_impact = calculate_achievement_impact(achievement_type);
        profile.reputation_score = profile.reputation_score + score_impact;
        profile.reputation_tier = calculate_tier(profile.reputation_score);
        
        // 更新身份标签
        update_categories_based_on_achievements(profile);
        
        emit_event(AchievementGranted {
            recipient,
            achievement_type: copy achievement_type,
            issuer: issuer_addr
        });
    }
    
    // 验证交易对手（供其他合约调用）
    public fun verify_counterparty(
        address_to_verify: address,
        minimum_tier: u8,
        required_categories: vector<string::String>
    ): bool acquires IdentityProfile {
        if (!exists<IdentityProfile>(address_to_verify)) {
            return false
        };
        
        let profile = borrow_global<IdentityProfile>(address_to_verify);
        
        // 检查声誉层级
        if (profile.reputation_tier < minimum_tier) {
            return false
        };
        
        // 检查所需标签
        let i = 0;
        while (i < vector::length(&required_categories)) {
            let required_category = *vector::borrow(&required_categories, i);
            if (!vector::contains(&profile.categories, &required_category)) {
                return false
            };
            i = i + 1;
        };
        
        true
    }
    
    // 获取地址身份摘要（View函数）
    public fun get_identity_summary(addr: address): IdentityProfile acquires IdentityProfile {
        assert!(exists<IdentityProfile>(addr), EPROFILE_NOT_FOUND);
        *borrow_global<IdentityProfile>(addr)
    }
    
    // 获取信任网络
    public fun get_trust_network(addr: address): vector<address> acquires IdentityProfile {
        assert!(exists<IdentityProfile>(addr), EPROFILE_NOT_FOUND);
        let profile = borrow_global<IdentityProfile>(addr);
        copy profile.trust_network
    }
}
