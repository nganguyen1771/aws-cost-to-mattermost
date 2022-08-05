
const { CostExplorerClient, GetCostAndUsageCommand } =  require("@aws-sdk/client-cost-explorer");
const axios = require('axios');

// Set the AWS Region
const REGION = "ap-southeast-1"; //e.g. "us-east-1"

const client = new CostExplorerClient({region: REGION});

const dt = new Date();
var start = new Date(dt);
var end = new Date(dt);
start.setMonth(start.getMonth() - 1);
start.setDate(1);
start = start.toISOString().substring(0,10);

end.setDate(1);
end = end.toISOString().substring(0,10);

const params = {
  Metrics: [
    'UNBLENDED_COST',
 ],
  Granularity: "DAILY",
  TimePeriod: {
    Start: start,
    End: end
  },
  "GroupBy": [
              {
                Key: "SERVICE",
              Type: "DIMENSION"
              },
              {
                Key: "LINKED_ACCOUNT",
                Type: "DIMENSION"
              }
    ]
};

const serviceTotalCalc = (serviceGroups) => {
  const serviceAmounts = serviceGroups.flatMap((service) => service.group);
  let rawServiceNames = serviceGroups.map(service => {
    return service.group.map (group => {
      return group.key;
    });
  });
const  serviceNames = rawServiceNames.flatMap(item => item).filter((e, i, a ) => a.indexOf(e) === i);
   serviceGroups[0].group.map((item) => item.key)
  const serviceTotals = serviceNames.map((item) => ({name: item,
    total:serviceAmounts.filter(service => service.key == item).reduce((total,i) => total + i.amount,0)
  }));
  return serviceTotals;
};

const costGraph = (serviceDailyCosts) => {
   return serviceDailyCosts.map (cost => {
    return {
      name: cost.name,
      line: sparkLine(cost.dailyCosts)
    }
  });

}

const sparks = ['▁', '▂', '▃', '▄', '▅', '▆', '▇']

const sparkLine = (points) => {
  const upper = Math.max(...points);
  const lower = Math.min(...points);
  const width = upper - lower;
  var line = "";
  points.forEach ( point => {
    const scaled = (width == 0) ? 1 : (point - lower)/ width ;
    line = line + sparks[parseInt(scaled * (sparks.length - 1))]
  }
  );
  return line;
};

const command = new GetCostAndUsageCommand(params);

exports.lambdaHandler = async (event,context) => {

  const costDetails = await client.send(command);
  //  const costDetails = data.data;
   //TODO: parse Linked Accounts
  const linkedAccounts = costDetails.DimensionValueAttributes.map ((attr)=> ({
      name: attr.Attributes.description,
      id: attr.Value
    }));
  //TODO: convert CostAndUsage to service amount total
   const MoneyUnit = costDetails.ResultsByTime[0].Groups[0].Metrics.UnblendedCost.Unit;

  const messages = linkedAccounts.map ((account) => {
    const serviceGroups = costDetails.ResultsByTime.map((result) => ({
      datetime: result.TimePeriod.Start,
      group: result.Groups.filter((group) => group.Keys.includes(account.id)).map((group) => ({key: group.Keys[0], amount: parseFloat(group.Metrics.UnblendedCost.Amount)}))
    }));

    const serviceTotals= serviceTotalCalc(serviceGroups);

    //TODO: calculate cost graph
    //filter services with total of amounts > 0 and sort high -> low
    let validServices = serviceTotals.filter(service => service.total > 0).sort((a,b) => b.total - a.total).map(service => service.name);

    let serviceDailyCosts = validServices.map(serviceName => {
      const costs = serviceGroups.map(serviceGroup => {
        const serviceCost = serviceGroup.group.filter(group => group.key == serviceName);
        return (serviceCost.length !== 0) ? serviceCost[0].amount : 0;
      });
      return {
        name: serviceName,
        dailyCosts: costs
      }
    });

    //add Total name in to validServices
    validServices.push('Total');

    const totalCost = serviceTotals.reduce((total,service) => total + service.total, 0);
    serviceTotals.push({
      name: 'Total',
      total: totalCost
    });

    const dailyCostGraphs = costGraph(serviceDailyCosts)
    let message = '';
    message = '#### Last month ('+ start.substring(0,7) + '), ' + 'Costs of ' + account.name +  ': ' + totalCost.toFixed(4) + MoneyUnit;
    message = message + "\n" + "| Service | Daily Cost | Last Month| \n";
    message = message + "|:--|:--:|---:|\n";

    validServices.forEach ( serviceName => {
      message = message + '| ' + ' ' + serviceName;
      const dailyCost = dailyCostGraphs.filter(costGraph => costGraph.name == serviceName);
      message = message + ' | ' + ((dailyCost.length !== 0) ? dailyCost[0].line : '');
      message = message + ' | ' + serviceTotals.filter(service => service.name == serviceName)[0].total.toFixed(4) + MoneyUnit + ' |\n';
    });
    return message;
  });

  for (let i = 0; i < messages.length; i++) {
    let payload= {
      "text": messages[i],
      };
    try {
    await axios({
      method: 'post',
      url: process.env.MATTERMOST_HOOK,
      headers: { 'content-type': 'application/json'},
      data: payload,
    })
    // .then (data => console.log("data: ",data))
    .catch(err => console.log("error: ",err));
    }
    catch (err) {
      console.log(err);
    };
  }

}
