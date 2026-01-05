// 浏览器增强界面：身份图谱可视化
import React, { useState, useEffect, useRef } from 'react';
import { EndlessClient } from '@endless/sdk';
import ForceGraph2D from 'react-force-graph-2d';
import * as d3 from 'd3';
import './IdentityGraph.css';

const IdentityGraphBrowser = () => {
  const [searchInput, setSearchInput] = useState('');
  const [currentAddress, setCurrentAddress] = useState(null);
  const [identityData, setIdentityData] = useState(null);
  const [graphData, setGraphData] = useState({ nodes: [], links: [] });
  const [activeView, setActiveView] = useState('graph'); // graph, details, timeline
  const [selectedNode, setSelectedNode] = useState(null);
  const graphRef = useRef(null);

  const endlessClient = new EndlessClient({
    network: 'testnet',
    nodeUrl: 'https://testnet.endless.link'
  });

  // 搜索地址并加载身份数据
  const searchAddress = async (address) => {
    if (!address.startsWith('0x') || address.length !== 42) {
      alert('请输入有效的Endless地址');
      return;
    }

    setCurrentAddress(address);
    
    try {
      // 获取链上身份数据
      const identity = await endlessClient.view({
        moduleAddress: '0x7c8d6e5f4a3b2c1d0e9f8a7b6c5d4e3f2a1b0c9d',
        moduleName: 'reputation',
        functionName: 'get_identity_summary',
        typeArguments: [],
        arguments: [address]
      });
      
      setIdentityData(identity);
      
      // 获取信任网络并构建图谱
      const trustNetwork = await endlessClient.view({
        moduleAddress: '0x7c8d6e5f4a3b2c1d0e9f8a7b6c5d4e3f2a1b0c9d',
        moduleName: 'reputation',
        functionName: 'get_trust_network',
        typeArguments: [],
        arguments: [address]
      });
      
      buildGraphData(address, identity, trustNetwork);
    } catch (error) {
      console.log('地址无身份记录，显示基础信息');
      // 加载基础交易数据
      const basicData = await endlessClient.getAccountResources(address);
      setIdentityData({
        address,
        reputation_score: 0,
        reputation_tier: 1,
        is_verified: false
      });
    }
  };

  // 构建图谱数据
  const buildGraphData = async (centerAddress, identity, trustNetwork) => {
    const nodes = [];
    const links = [];
    
    // 中心节点
    nodes.push({
      id: centerAddress,
      name: shortenAddress(centerAddress),
      val: identity.reputation_score / 50 + 5, // 节点大小基于声誉
      color: getTierColor(identity.reputation_tier),
      group: 1,
      type: 'center',
      ...identity
    });
    
    // 添加直接连接节点
    for (let i = 0; i < Math.min(trustNetwork.length, 20); i++) { // 限制数量
      const connectedAddress = trustNetwork[i];
      
      // 获取连接节点的基本信息
      let connectedIdentity;
      try {
        connectedIdentity = await endlessClient.view({
          moduleAddress: '0x7c8d6e5f4a3b2c1d0e9f8a7b6c5d4e3f2a1b0c9d',
          moduleName: 'reputation',
          functionName: 'get_identity_summary',
          typeArguments: [],
          arguments: [connectedAddress]
        });
      } catch {
        connectedIdentity = {
          reputation_score: 0,
          reputation_tier: 1
        };
      }
      
      nodes.push({
        id: connectedAddress,
        name: shortenAddress(connectedAddress),
        val: connectedIdentity.reputation_score / 50 + 3,
        color: getTierColor(connectedIdentity.reputation_tier),
        group: 2,
        type: 'connection'
      });
      
      links.push({
        source: centerAddress,
        target: connectedAddress,
        value: 2 // 连接强度
      });
      
      // 添加二级连接（示例）
      if (i < 5) {
        // 模拟二级连接
        const secondaryAddress = `0x${Math.random().toString(16).substr(2, 40)}`;
        nodes.push({
          id: secondaryAddress,
          name: shortenAddress(secondaryAddress),
          val: 2,
          color: '#999',
          group: 3,
          type: 'secondary'
        });
        
        links.push({
          source: connectedAddress,
          target: secondaryAddress,
          value: 1
        });
      }
    }
    
    setGraphData({ nodes, links });
  };

  // 可视化配置
  const graphConfig = {
    nodeRelSize: 6,
    nodeId: 'id',
    nodeLabel: 'name',
    nodeVal: 'val',
    nodeColor: 'color',
    linkWidth: 2,
    linkDirectionalParticles: 2,
    linkDirectionalParticleSpeed: 0.005,
    onNodeClick: (node) => {
      setSelectedNode(node);
      setActiveView('details');
    },
    onNodeRightClick: (node) => {
      // 右键菜单：查看详情、建立连接等
      showNodeContextMenu(node);
    }
  };

  // 建立信任连接（模拟）
  const establishTrustConnection = async (targetAddress, connectionType) => {
    if (!currentAddress) {
      alert('请先连接钱包');
      return;
    }
    
    const payload = {
      type: 'entry_function_payload',
      function: '0x7c8d6e5f4a3b2c1d0e9f8a7b6c5d4e3f2a1b0c9d::reputation::establish_trust_connection',
      typeArguments: [],
      arguments: [targetAddress, connectionType, 5, ['browser_verified']]
    };
    
    // 在实际实现中，这里需要钱包签名
    console.log('建立信任连接:', payload);
    alert(`已向${shortenAddress(targetAddress)}发送${connectionType}连接请求`);
    
    // 更新图谱
    if (selectedNode) {
      const newLink = {
        source: currentAddress,
        target: targetAddress,
        value: 3
      };
      setGraphData(prev => ({
        nodes: prev.nodes,
        links: [...prev.links, newLink]
      }));
    }
  };

  // 验证地址身份
  const verifyAddress = async () => {
    // 集成Luffa DID验证流程
    const luffaVerified = await checkLuffaVerification(currentAddress);
    
    if (luffaVerified) {
      // 提交验证到链上
      const payload = {
        type: 'entry_function_payload',
        function: '0x7c8d6e5f4a3b2c1d0e9f8a7b6c5d4e3f2a1b0c9d::reputation::upsert_identity_profile',
        typeArguments: [],
        arguments: [
          `luffa:${luffaVerified.userId}`,
          [{ platform: 'luffa', username: luffaVerified.username, verified_at: Date.now() }]
        ]
      };
      
      console.log('提交身份验证:', payload);
      alert('身份验证已提交到区块链');
    }
  };

  // 获取地址交易时间线
  const fetchAddressTimeline = async (address) => {
    const transactions = await endlessClient.getAccountTransactions(address, { limit: 50 });
    
    // 分析交易类型和模式
    const timeline = transactions.map(tx => ({
      timestamp: tx.timestamp,
      type: classifyTransaction(tx),
      counterparty: tx.receiver === address ? tx.sender : tx.receiver,
      amount: tx.amount,
      description: generateTransactionDescription(tx)
    }));
    
    return timeline;
  };

  // 声誉分数计算可视化
  const calculateReputationBreakdown = (identity) => {
    return {
      交易历史: Math.min(identity.reputation_score * 0.4, 400),
      社交验证: identity.verified_socials?.length * 50 || 0,
      成就徽章: identity.verified_achievements?.length * 30 || 0,
      网络信任: identity.trust_network?.length * 5 || 0,
      社区参与: 100 // 模拟值
    };
  };

  // 辅助函数
  const shortenAddress = (addr) => `${addr.substr(0, 6)}...${addr.substr(-4)}`;
  
  const getTierColor = (tier) => {
    const colors = ['#888', '#4CAF50', '#2196F3', '#9C27B0', '#FF9800'];
    return colors[Math.min(tier - 1, colors.length - 1)] || '#888';
  };

  const getTierLabel = (tier) => {
    const labels = ['新人', '活跃者', '贡献者', '专家', '传奇'];
    return labels[Math.min(tier - 1, labels.length - 1)] || '未知';
  };

  useEffect(() => {
    if (currentAddress) {
      searchAddress(currentAddress);
    }
  }, [currentAddress]);

  return (
    <div className="identity-graph-browser">
      <header className="browser-header">
        <h1>Endless IdentityGraph - 链上身份浏览器</h1>
        <div className="search-section">
          <input
            type="text"
            placeholder="输入Endless地址 (0x...) 或Luffa DID"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && searchAddress(searchInput)}
          />
          <button onClick={() => searchAddress(searchInput)}>搜索</button>
          <button onClick={verifyAddress} className="verify-btn">
            🔍 验证我的身份
          </button>
        </div>
      </header>

      <div className="main-container">
        {/* 左侧：身份图谱可视化 */}
        <div className="graph-container">
          <div className="view-controls">
            <button 
              className={activeView === 'graph' ? 'active' : ''}
              onClick={() => setActiveView('graph')}
            >
              关系图谱
            </button>
            <button 
              className={activeView === 'details' ? 'active' : ''}
              onClick={() => setActiveView('details')}
            >
              身份详情
            </button>
            <button 
              className={activeView === 'timeline' ? 'active' : ''}
              onClick={() => setActiveView('timeline')}
            >
              活动时间线
            </button>
          </div>

          {activeView === 'graph' && (
            <div className="force-graph-wrapper">
              {graphData.nodes.length > 0 ? (
                <ForceGraph2D
                  ref={graphRef}
                  graphData={graphData}
                  {...graphConfig}
                  width={800}
                  height={600}
                />
              ) : (
                <div className="empty-graph">
                  <p>搜索地址以查看其信任网络图谱</p>
                  <p>或尝试示例地址: 0x1234...5678</p>
                </div>
              )}
            </div>
          )}

          {activeView === 'details' && identityData && (
            <div className="identity-details">
              <div className="identity-header">
                <div className="address-badge">
                  <span className="address">{shortenAddress(identityData.address)}</span>
                  <span className={`tier-badge tier-${identityData.reputation_tier}`}>
                    {getTierLabel(identityData.reputation_tier)}
                  </span>
                </div>
                <div className="reputation-score">
                  <div className="score-circle">
                    <span className="score">{identityData.reputation_score}</span>
                    <span className="score-label">声誉分数</span>
                  </div>
                </div>
              </div>

              <div className="reputation-breakdown">
                <h3>声誉构成</h3>
                {Object.entries(calculateReputationBreakdown(identityData)).map(([category, score]) => (
                  <div key={category} className="breakdown-item">
                    <span className="category">{category}</span>
                    <div className="score-bar">
                      <div 
                        className="score-fill" 
                        style={{ width: `${score / 5}%` }}
                      />
                    </div>
                    <span className="score-value">{score}</span>
                  </div>
                ))}
              </div>

              {identityData.verified_achievements?.length > 0 && (
                <div className="achievements-section">
                  <h3>成就徽章</h3>
                  <div className="achievements-grid">
                    {identityData.verified_achievements.map((achievement, idx) => (
                      <div key={idx} className="achievement-badge">
                        <div className="badge-icon">🏆</div>
                        <div className="badge-info">
                          <strong>{achievement.title}</strong>
                          <small>{achievement.description}</small>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {identityData.verified_socials?.length > 0 && (
                <div className="social-verifications">
                  <h3>已验证社交账户</h3>
                  <div className="social-icons">
                    {identityData.verified_socials.map((social, idx) => (
                      <div key={idx} className="social-badge">
                        {social.platform === 'luffa' ? '💬' : 
                         social.platform === 'twitter' ? '🐦' : '👤'}
                        <span>{social.username}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {activeView === 'timeline' && currentAddress && (
            <div className="timeline-view">
              <h3>链上活动时间线</h3>
              <TimelineVisualization address={currentAddress} />
            </div>
          )}
        </div>

        {/* 右侧：控制面板和工具 */}
        <div className="control-panel">
          <div className="identity-tools">
            <h3>身份工具</h3>
            
            {selectedNode && (
              <div className="selected-node-info">
                <h4>选中节点</h4>
                <p>{selectedNode.name}</p>
                <p>声誉层级: {getTierLabel(selectedNode.reputation_tier || 1)}</p>
                
                <div className="node-actions">
                  <button onClick={() => establishTrustConnection(selectedNode.id, 'follow')}>
                    👥 关注
                  </button>
                  <button onClick={() => establishTrustConnection(selectedNode.id, 'endorsement')}>
                    👍 认可
                  </button>
                  <button onClick={() => {
                    setCurrentAddress(selectedNode.id);
                    setSelectedNode(null);
                  }}>
                    🔍 查看详情
                  </button>
                </div>
              </div>
            )}

            <div className="trust-actions">
              <h4>建立信任连接</h4>
              <input 
                type="text" 
                placeholder="输入地址"
                id="trust-address"
              />
              <select id="connection-type">
                <option value="follow">关注</option>
                <option value="endorsement">认可</option>
                <option value="collaboration">合作</option>
                <option value="friendship">好友</option>
              </select>
              <button onClick={() => {
                const address = document.getElementById('trust-address').value;
                const type = document.getElementById('connection-type').value;
                if (address) establishTrustConnection(address, type);
              }}>
                建立连接
              </button>
            </div>

            <div className="verification-options">
              <h4>验证选项</h4>
              <button onClick={() => window.open('https://luffa.im', '_blank')}>
                连接Luffa验证身份
              </button>
              <button>
                上传证明文件
              </button>
              <button>
                请求他人验证
              </button>
            </div>
          </div>

          <div className="stats-panel">
            <h3>网络统计</h3>
            <div className="stat-item">
              <span className="stat-label">总已验证身份</span>
              <span className="stat-value">1,234</span>
            </div>
            <div className="stat-item">
              <span className="stat-label">平均声誉分数</span>
              <span className="stat-value">356</span>
            </div>
            <div className="stat-item">
              <span className="stat-label">今日新连接</span>
              <span className="stat-value">47</span>
            </div>
            <div className="stat-item">
              <span className="stat-label">最活跃分类</span>
              <span className="stat-value">DeFi交易者</span>
            </div>
          </div>

          <div className="discovery-panel">
            <h3>发现</h3>
            <div className="discovery-item">
              <p>🎨 <strong>顶级NFT收藏家</strong></p>
              <p>查看拥有最多Endless NFT的地址</p>
              <button>探索</button>
            </div>
            <div className="discovery-item">
              <p>🏛 <strong>DAO治理专家</strong></p>
              <p>参与最多治理提案的地址</p>
              <button>探索</button>
            </div>
            <div className="discovery-item">
              <p>🤝 <strong>最受信任节点</strong></p>
              <p>拥有最多信任连接的地址</p>
              <button>探索</button>
            </div>
          </div>
        </div>
      </div>

      {/* 底部：快速搜索和示例 */}
      <div className="quick-search-footer">
        <h4>快速搜索示例</h4>
        <div className="example-addresses">
          <button onClick={() => searchAddress('0x1234567890123456789012345678901234567890')}>
            高声誉DeFi交易者
          </button>
          <button onClick={() => searchAddress('0xabcdef1234567890abcdef1234567890abcdef12')}>
            NFT创作者
          </button>
          <button onClick={() => searchAddress('0x7890123456789012345678901234567890123456')}>
            DAO治理参与者
          </button>
          <button onClick={() => searchAddress('0xfedcba9876543210fedcba9876543210fedcba98')}>
            新用户（低声誉）
          </button>
        </div>
      </div>
    </div>
  );
};

// 辅助组件：时间线可视化
const TimelineVisualization = ({ address }) => {
  const [timelineData, setTimelineData] = useState([]);
  
  useEffect(() => {
    // 模拟时间线数据
    const mockTimeline = [
      { date: '2024-01-15', event: '创建钱包', type: 'wallet' },
      { date: '2024-02-10', event: '第一笔EDS交易', type: 'transaction' },
      { date: '2024-03-05', event: '连接Luffa身份', type: 'verification' },
      { date: '2024-03-20', event: '购买第一个NFT', type: 'nft' },
      { date: '2024-04-12', event: '参与DAO投票', type: 'governance' },
      { date: '2024-05-01', event: '获得早期用户徽章', type: 'achievement' },
      { date: '2024-05-15', event: '建立5个信任连接', type: 'network' },
    ];
    
    setTimelineData(mockTimeline);
  }, [address]);
  
  return (
    <div className="timeline">
      {timelineData.map((item, index) => (
        <div key={index} className="timeline-item">
          <div className="timeline-marker">
            {item.type === 'wallet' && '👛'}
            {item.type === 'transaction' && '💸'}
            {item.type === 'verification' && '✅'}
            {item.type === 'nft' && '🖼'}
            {item.type === 'governance' && '🗳'}
            {item.type === 'achievement' && '🏆'}
            {item.type === 'network' && '🤝'}
          </div>
          <div className="timeline-content">
            <div className="timeline-date">{item.date}</div>
            <div className="timeline-event">{item.event}</div>
          </div>
        </div>
      ))}
    </div>
  );
};

export default IdentityGraphBrowser;
